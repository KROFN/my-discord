import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/utils/supabase/client'
import { RealtimeChannel } from '@supabase/supabase-js'

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:global.stun.twilio.com:3478' }
  ],
}

interface Peer {
  id: string
  stream: MediaStream
}

export function useWebRTC(roomId: string, user: any) {
  const [peers, setPeers] = useState<Peer[]>([])
  const [localStream, setLocalStream] = useState<MediaStream | null>(null)
  const [isMuted, setIsMuted] = useState(false)
  
  const peerConnections = useRef<{ [key: string]: RTCPeerConnection }>({})
  const channelRef = useRef<RealtimeChannel | null>(null)
  const supabase = createClient()

  // 1. ЗАХВАТ МИКРОФОНА
  useEffect(() => {
    if (!user) return

    async function initMedia() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
        console.log("✅ Microphone access granted")
        setLocalStream(stream)
      } catch (err) {
        console.error("❌ Error accessing microphone:", err)
      }
    }
    initMedia()

    return () => {
      localStream?.getTracks().forEach(t => t.stop())
    }
  }, [user])

  // 2. СИГНАЛИЗАЦИЯ (WebRTC)
  useEffect(() => {
    if (!roomId || !user || !localStream) return

    // Уникальный ID для этого подключения (на случай если юзер открыл 2 вкладки)
    const presenceId = user.id

    console.log(`🔌 Connecting to signaling channel: room:${roomId}`)

    const createPeerConnection = (peerId: string) => {
      if (peerConnections.current[peerId]) return peerConnections.current[peerId]

      console.log(`🔗 Creating PeerConnection with ${peerId}`)
      const pc = new RTCPeerConnection(ICE_SERVERS)
      peerConnections.current[peerId] = pc

      localStream.getTracks().forEach((track) => {
        pc.addTrack(track, localStream)
      })

      pc.ontrack = (event) => {
        console.log(`🔊 Received audio track from ${peerId}`)
        const [remoteStream] = event.streams
        setPeers((prev) => {
          if (prev.find(p => p.id === peerId)) return prev
          return [...prev, { id: peerId, stream: remoteStream }]
        })
      }

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          channelRef.current?.send({
            type: 'broadcast',
            event: 'ice-candidate',
            payload: { candidate: event.candidate, to: peerId, from: user.id },
          })
        }
      }

      pc.onconnectionstatechange = () => {
        console.log(`📶 Connection state with ${peerId}: ${pc.connectionState}`)
        if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
          setPeers(prev => prev.filter(p => p.id !== peerId))
          delete peerConnections.current[peerId]
        }
      }

      return pc
    }

    const channel = supabase.channel(`room:${roomId}`, {
      config: { 
        presence: { 
          key: presenceId,
        },
      },
    })

    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState()
        console.log('👥 Presence Sync state:', state)
      })
      .on('presence', { event: 'join' }, ({ key }) => {
        console.log(`👤 User JOINED: ${key}`)
        // Если кто-то новый зашел, мы (старички) ничего не делаем, ждем его оффера.
        // Или можем сами инициировать. В Mesh проще, если "входящий" инициирует.
      })
      .on('presence', { event: 'leave' }, ({ key }) => {
        console.log(`👋 User LEFT: ${key}`)
        setPeers(prev => prev.filter(p => p.id !== key))
        if (peerConnections.current[key]) {
          peerConnections.current[key].close()
          delete peerConnections.current[key]
        }
      })
      .on('broadcast', { event: 'offer' }, async ({ payload }) => {
        if (payload.to !== user.id) return
        console.log(`📩 Received OFFER from ${payload.from}`)

        const pc = createPeerConnection(payload.from)
        await pc.setRemoteDescription(new RTCSessionDescription(payload.offer))
        const answer = await pc.createAnswer()
        await pc.setLocalDescription(answer)

        channel.send({
          type: 'broadcast',
          event: 'answer',
          payload: { answer, to: payload.from, from: user.id },
        })
      })
      .on('broadcast', { event: 'answer' }, async ({ payload }) => {
        if (payload.to !== user.id) return
        console.log(`📩 Received ANSWER from ${payload.from}`)
        
        const pc = peerConnections.current[payload.from]
        if (pc) {
          await pc.setRemoteDescription(new RTCSessionDescription(payload.answer))
        }
      })
      .on('broadcast', { event: 'ice-candidate' }, async ({ payload }) => {
        if (payload.to !== user.id) return
        const pc = peerConnections.current[payload.from]
        if (pc) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(payload.candidate))
          } catch (e) { console.error(e) }
        }
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          console.log("✅ Channel subscribed! TRACKING PRESENCE NOW...")
          
          // ВОТ ЭТОГО НЕ ХВАТАЛО! Мы сообщаем серверу, что мы тут.
          await channel.track({ online_at: new Date().toISOString() })
          
          // Даем время серверу обновить списки
          setTimeout(async () => {
            const state = channel.presenceState()
            const onlineUsers = Object.keys(state)
            console.log("📋 Users currently in room:", onlineUsers)
            
            for (const peerId of onlineUsers) {
              if (peerId === user.id) continue
              
              console.log(`🚀 Initiating call to existing user: ${peerId}`)
              const pc = createPeerConnection(peerId)
              const offer = await pc.createOffer()
              await pc.setLocalDescription(offer)
              
              channel.send({
                type: 'broadcast',
                event: 'offer',
                payload: { offer, to: peerId, from: user.id },
              })
            }
          }, 1000)
        }
      })

    channelRef.current = channel

    return () => {
      channel.untrack() // Перестаем отслеживаться при выходе
      Object.values(peerConnections.current).forEach(pc => pc.close())
      channel.unsubscribe()
    }
  }, [roomId, user, localStream])

  const toggleMute = () => {
    if (localStream) {
      localStream.getAudioTracks().forEach(track => {
        track.enabled = !track.enabled
      })
      setIsMuted(!isMuted)
    }
  }

  return { peers, localStream, isMuted, toggleMute }
}