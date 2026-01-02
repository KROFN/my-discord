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
  username: string // <--- ДОБАВИЛИ ПОЛЕ
}

export function useWebRTC(roomId: string, user: any) {
  const [peers, setPeers] = useState<Peer[]>([])
  const [localStream, setLocalStream] = useState<MediaStream | null>(null)
  const [isMuted, setIsMuted] = useState(false)
  
  const peerConnections = useRef<{ [key: string]: RTCPeerConnection }>({})
  // Записная книжка: ID -> Имя
  const peerUsernames = useRef<{ [key: string]: string }>({}) 
  const channelRef = useRef<RealtimeChannel | null>(null)
  const supabase = createClient()

  useEffect(() => {
    if (!user) return
    let mounted = true
    async function initMedia() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
        if (mounted) {
          console.log("✅ Microphone access granted")
          setLocalStream(stream)
        }
      } catch (err) {
        console.error("❌ Error accessing microphone:", err)
      }
    }
    initMedia()
    return () => { mounted = false }
  }, [user])

  useEffect(() => {
    if (!roomId || !user || !localStream) return
    if (channelRef.current) return

    console.log(`🔌 Initializing signaling for room: ${roomId}`)

    const createPeerConnection = (peerId: string) => {
      if (peerConnections.current[peerId]) return peerConnections.current[peerId]

      console.log(`🔗 Creating NEW PeerConnection with ${peerId}`)
      const pc = new RTCPeerConnection(ICE_SERVERS)
      peerConnections.current[peerId] = pc

      localStream.getTracks().forEach((track) => pc.addTrack(track, localStream))

      pc.ontrack = (event) => {
        console.log(`🔊 Received audio track from ${peerId}`)
        const [remoteStream] = event.streams
        
        // Достаем имя из "Записной книжки", или ставим 'Unknown', если не успело прийти
        const name = peerUsernames.current[peerId] || 'Unknown'
        
        setPeers((prev) => {
          if (prev.find(p => p.id === peerId)) return prev
          return [...prev, { id: peerId, stream: remoteStream, username: name }]
        })
      }

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          channel.send({
            type: 'broadcast',
            event: 'ice-candidate',
            payload: { candidate: event.candidate, to: peerId, from: user.id },
          })
        }
      }

      pc.onconnectionstatechange = () => {
        const state = pc.connectionState
        if (state === 'disconnected' || state === 'failed' || state === 'closed') {
          setPeers(prev => prev.filter(p => p.id !== peerId))
          delete peerConnections.current[peerId]
        }
      }

      return pc
    }

    const channel = supabase.channel(`room:${roomId}`, {
      config: { presence: { key: user.id } },
    })

    channel
      .on('presence', { event: 'join' }, async ({ key }) => {
        if (key === user.id) return
        const pc = createPeerConnection(key)
        const offer = await pc.createOffer()
        await pc.setLocalDescription(offer)
        
        // ОТПРАВЛЯЕМ СВОЕ ИМЯ В ОФФЕРЕ
        channel.send({
          type: 'broadcast',
          event: 'offer',
          payload: { 
            offer, 
            to: key, 
            from: user.id,
            username: user.email // <--- ВОТ ТУТ
          },
        })
      })
      .on('presence', { event: 'leave' }, ({ key }) => {
        setPeers(prev => prev.filter(p => p.id !== key))
        if (peerConnections.current[key]) {
          peerConnections.current[key].close()
          delete peerConnections.current[key]
        }
      })
      .on('broadcast', { event: 'offer' }, async ({ payload }) => {
        if (payload.to !== user.id) return
        
        // ЗАПОМИНАЕМ ИМЯ ЗВОНЯЩЕГО
        if (payload.username) {
            peerUsernames.current[payload.from] = payload.username
        }

        const existingPc = peerConnections.current[payload.from]
        if (existingPc && existingPc.signalingState !== 'stable') {
           console.warn("⚠️ Re-negotiating connection...")
        }

        const pc = createPeerConnection(payload.from)
        await pc.setRemoteDescription(new RTCSessionDescription(payload.offer))
        const answer = await pc.createAnswer()
        await pc.setLocalDescription(answer)

        // ОТПРАВЛЯЕМ СВОЕ ИМЯ В ОТВЕТЕ
        channel.send({
          type: 'broadcast',
          event: 'answer',
          payload: { 
            answer, 
            to: payload.from, 
            from: user.id,
            username: user.email // <--- И ВОТ ТУТ
          },
        })
      })
      .on('broadcast', { event: 'answer' }, async ({ payload }) => {
        if (payload.to !== user.id) return
        
        // ЗАПОМИНАЕМ ИМЯ ОТВЕТИВШЕГО
        if (payload.username) {
            peerUsernames.current[payload.from] = payload.username
        }

        const pc = peerConnections.current[payload.from]
        if (pc) {
          if (pc.signalingState === 'stable') return 
          await pc.setRemoteDescription(new RTCSessionDescription(payload.answer))
        }
      })
      .on('broadcast', { event: 'ice-candidate' }, async ({ payload }) => {
        if (payload.to !== user.id) return
        const pc = peerConnections.current[payload.from]
        if (pc && pc.remoteDescription) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(payload.candidate))
          } catch (e) { console.warn(e) }
        }
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          console.log("✅ Subscribed to signaling")
          await channel.track({ online_at: new Date().toISOString() })
          
          const state = channel.presenceState()
          for (const peerId of Object.keys(state)) {
             if (peerId === user.id || peerConnections.current[peerId]) continue 
             
             const pc = createPeerConnection(peerId)
             const offer = await pc.createOffer()
             await pc.setLocalDescription(offer)
             
             channel.send({
               type: 'broadcast',
               event: 'offer',
               payload: { 
                 offer, 
                 to: peerId, 
                 from: user.id,
                 username: user.email // <--- И ТУТ ТОЖЕ
               },
             })
          }
        }
      })

    channelRef.current = channel

    return () => {
      console.log("🧹 Cleanup WebRTC")
      channel.untrack()
      channel.unsubscribe()
      channelRef.current = null
      Object.values(peerConnections.current).forEach(pc => pc.close())
      peerConnections.current = {}
      setPeers([])
    }
  }, [roomId, user, localStream])

  const toggleMute = () => {
    if (localStream) {
      localStream.getAudioTracks().forEach(track => { track.enabled = !track.enabled })
      setIsMuted(!isMuted)
    }
  }

  return { peers, localStream, isMuted, toggleMute }
}