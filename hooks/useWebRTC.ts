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
  username: string
}

export function useWebRTC(roomId: string, user: any) {
  const [peers, setPeers] = useState<Peer[]>([])
  const [localStream, setLocalStream] = useState<MediaStream | null>(null)
  const [isScreenSharing, setIsScreenSharing] = useState(false)
  const [isMuted, setIsMuted] = useState(false)
  
  const peerConnections = useRef<{ [key: string]: RTCPeerConnection }>({})
  const peerUsernames = useRef<{ [key: string]: string }>({}) 
  const channelRef = useRef<RealtimeChannel | null>(null)
  const screenTrackRef = useRef<MediaStreamTrack | null>(null) // Храним трек экрана
  const supabase = createClient()

  // 1. ЗАХВАТ МИКРОФОНА
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

  // 2. ФУНКЦИЯ ВКЛ/ВЫКЛ ЭКРАНА
  const toggleScreenShare = async () => {
    if (isScreenSharing) {
      // ВЫКЛЮЧАЕМ
      stopScreenShare()
    } else {
      // ВКЛЮЧАЕМ
      try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
        const screenTrack = screenStream.getVideoTracks()[0]
        
        screenTrackRef.current = screenTrack
        setIsScreenSharing(true)

        // Добавляем трек экрана во все активные соединения
        Object.values(peerConnections.current).forEach(pc => {
          // sender заменяет или добавляет трек. В Mesh проще добавить новый.
          // Используем addTrack, он триггернет negotiationneeded
          if (localStream) {
             pc.addTrack(screenTrack, localStream) 
          }
        })

        // Если юзер нажмет "Остановить" в браузере (системная плашка)
        screenTrack.onended = () => stopScreenShare()

      } catch (err) {
        console.error("Error sharing screen:", err)
      }
    }
  }

  const stopScreenShare = () => {
    if (screenTrackRef.current) {
      screenTrackRef.current.stop() // Останавливаем захват
      
      // Удаляем трек из всех соединений
      Object.values(peerConnections.current).forEach(pc => {
        const senders = pc.getSenders()
        const videoSender = senders.find(s => s.track?.kind === 'video')
        if (videoSender) {
          pc.removeTrack(videoSender)
        }
      })
      screenTrackRef.current = null
      setIsScreenSharing(false)
    }
  }

  // 3. СИГНАЛИЗАЦИЯ
  useEffect(() => {
    if (!roomId || !user || !localStream) return
    if (channelRef.current) return

    console.log(`🔌 Initializing signaling for room: ${roomId}`)

    const createPeerConnection = (peerId: string) => {
      if (peerConnections.current[peerId]) return peerConnections.current[peerId]

      console.log(`🔗 Creating NEW PeerConnection with ${peerId}`)
      const pc = new RTCPeerConnection(ICE_SERVERS)
      peerConnections.current[peerId] = pc

      // Добавляем аудио
      localStream.getTracks().forEach((track) => pc.addTrack(track, localStream))
      // Если уже стримим экран, добавляем и его сразу при подключении нового юзера
      if (screenTrackRef.current) {
        pc.addTrack(screenTrackRef.current, localStream)
      }

      // --- RENEGOTIATION (ВАЖНО ДЛЯ ЭКРАНА) ---
      // Когда мы добавляем видео-трек, WebRTC понимает, что нужно обновить настройки
      pc.onnegotiationneeded = async () => {
          console.log(`🔄 Negotiation needed with ${peerId}`)
          try {
             // Проверка состояния, чтобы не нарваться на ошибку "stable"
             if (pc.signalingState !== "stable") return;

             const offer = await pc.createOffer()
             await pc.setLocalDescription(offer)
             
             channel.send({
                type: 'broadcast',
                event: 'offer',
                payload: { offer, to: peerId, from: user.id, username: user.email },
             })
          } catch (e) {
             console.warn("Negotiation error:", e)
          }
      }

      pc.ontrack = (event) => {
        console.log(`🔊/📺 Received track from ${peerId}:`, event.track.kind)
        const [remoteStream] = event.streams
        
        const name = peerUsernames.current[peerId] || 'Unknown'
        setPeers((prev) => {
          // Если такой пир есть, обновляем его стрим (там могло появиться видео)
          const existing = prev.find(p => p.id === peerId)
          if (existing) {
             return prev.map(p => p.id === peerId ? { ...p, stream: remoteStream } : p)
          }
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
        createPeerConnection(key) 
        // Мы НЕ создаем оффер тут вручную, так как сработает onnegotiationneeded при добавлении треков
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
        if (payload.username) peerUsernames.current[payload.from] = payload.username

        const pc = createPeerConnection(payload.from)
        
        // Избегаем конфликтов
        if (pc.signalingState !== "stable") {
             // Если мы уже что-то настраиваем, можно проигнорировать или откатить.
             // Для простоты: пробуем установить remote
             await Promise.all([
                pc.setLocalDescription({type: "rollback"}),
                pc.setRemoteDescription(new RTCSessionDescription(payload.offer))
             ]).catch(() => pc.setRemoteDescription(new RTCSessionDescription(payload.offer)))
        } else {
             await pc.setRemoteDescription(new RTCSessionDescription(payload.offer))
        }
        
        const answer = await pc.createAnswer()
        await pc.setLocalDescription(answer)

        channel.send({
          type: 'broadcast',
          event: 'answer',
          payload: { answer, to: payload.from, from: user.id, username: user.email },
        })
      })
      .on('broadcast', { event: 'answer' }, async ({ payload }) => {
        if (payload.to !== user.id) return
        if (payload.username) peerUsernames.current[payload.from] = payload.username

        const pc = peerConnections.current[payload.from]
        if (pc && pc.signalingState !== 'stable') { 
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
             createPeerConnection(peerId) 
             // Оффер полетит сам из onnegotiationneeded
          }
        }
      })

    channelRef.current = channel

    return () => {
      console.log("🧹 Cleanup WebRTC")
      if (screenTrackRef.current) screenTrackRef.current.stop()
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

  return { peers, localStream, isMuted, toggleMute, isScreenSharing, toggleScreenShare }
}