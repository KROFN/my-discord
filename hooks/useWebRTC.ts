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
  const screenTrackRef = useRef<MediaStreamTrack | null>(null)
  
  // Флаг: "Я сейчас пытаюсь сделать оффер?" (нужен для решения конфликтов)
  const makingOfferRef = useRef<{ [key: string]: boolean }>({})
  const ignoreOfferRef = useRef<{ [key: string]: boolean }>({})
  
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

  // 2. УПРАВЛЕНИЕ ЭКРАНОМ
  const toggleScreenShare = async () => {
    if (isScreenSharing) {
      stopScreenShare()
    } else {
      try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
        const screenTrack = screenStream.getVideoTracks()[0]
        
        screenTrackRef.current = screenTrack
        setIsScreenSharing(true)

        // Добавляем трек во все соединения. Это триггернет 'negotiationneeded'
        Object.values(peerConnections.current).forEach(pc => {
          if (localStream) {
             pc.addTrack(screenTrack, localStream) 
          }
        })

        screenTrack.onended = () => stopScreenShare()

      } catch (err) {
        console.error("Error sharing screen:", err)
      }
    }
  }

  const stopScreenShare = () => {
    if (screenTrackRef.current) {
      screenTrackRef.current.stop()
      Object.values(peerConnections.current).forEach(pc => {
        const senders = pc.getSenders()
        const videoSender = senders.find(s => s.track?.kind === 'video')
        if (videoSender) pc.removeTrack(videoSender)
      })
      screenTrackRef.current = null
      setIsScreenSharing(false)
    }
  }

  // 3. СИГНАЛИЗАЦИЯ (PERFECT NEGOTIATION PATTERN)
  useEffect(() => {
    if (!roomId || !user || !localStream) return
    if (channelRef.current) return

    console.log(`🔌 Initializing signaling for room: ${roomId}`)

    const createPeerConnection = (peerId: string) => {
      if (peerConnections.current[peerId]) return peerConnections.current[peerId]

      const pc = new RTCPeerConnection(ICE_SERVERS)
      peerConnections.current[peerId] = pc
      makingOfferRef.current[peerId] = false
      ignoreOfferRef.current[peerId] = false

      // Добавляем треки
      localStream.getTracks().forEach((track) => pc.addTrack(track, localStream))
      if (screenTrackRef.current) {
        pc.addTrack(screenTrackRef.current, localStream)
      }

      // --- ГЛАВНАЯ МАГИЯ: ON NEGOTIATION NEEDED ---
      pc.onnegotiationneeded = async () => {
        try {
          makingOfferRef.current[peerId] = true
          console.log(`🔄 Negotiation needed with ${peerId}`)
          
          const offer = await pc.createOffer()
          // Если мы в состоянии конфликта, setLocalDescription может упасть, это ок
          if (pc.signalingState !== 'stable') return 

          await pc.setLocalDescription(offer)
          
          channel.send({
             type: 'broadcast',
             event: 'offer',
             payload: { offer, to: peerId, from: user.id, username: user.email },
          })
        } catch (err) {
          console.error("Negotiation error:", err)
        } finally {
          makingOfferRef.current[peerId] = false
        }
      }

      pc.ontrack = (event) => {
        const [remoteStream] = event.streams
        const name = peerUsernames.current[peerId] || 'Unknown'
        console.log(`📺 Received ${event.track.kind} track from ${name}`)
        
        setPeers((prev) => {
          const existing = prev.find(p => p.id === peerId)
          if (existing) {
             // Если стрим обновился (добавилось видео), обновляем объект
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
      .on('presence', { event: 'join' }, ({ key }) => {
        if (key === user.id) return
        createPeerConnection(key)
        // Не создаем оффер вручную, onnegotiationneeded сделает это сам
      })
      .on('presence', { event: 'leave' }, ({ key }) => {
        setPeers(prev => prev.filter(p => p.id !== key))
        if (peerConnections.current[key]) {
           peerConnections.current[key].close()
           delete peerConnections.current[key]
        }
      })
      
      // --- ОБРАБОТКА КОНФЛИКТОВ (GLARE) ---
      .on('broadcast', { event: 'offer' }, async ({ payload }) => {
        if (payload.to !== user.id) return
        if (payload.username) peerUsernames.current[payload.from] = payload.username

        const pc = createPeerConnection(payload.from)
        
        // КТО ВЕЖЛИВЫЙ? (Сравниваем строки ID)
        // Если мой ID меньше (лексикографически) -> я вежливый, я уступаю.
        const polite = user.id.localeCompare(payload.from) < 0 

        const offerCollision = makingOfferRef.current[payload.from] || pc.signalingState !== 'stable'

        // Если конфликт:
        if (offerCollision) {
           if (!polite) {
             console.warn("🛡️ Impolite: Ignoring colliding offer")
             ignoreOfferRef.current[payload.from] = true
             return // Я наглый, я игнорирую твой оффер, жди моего
           }
           console.log("🙇‍♂️ Polite: Rolling back to accept offer")
           // Я вежливый - откатываюсь, чтобы принять твой оффер
           await Promise.all([
             pc.setLocalDescription({ type: "rollback" }),
             pc.setRemoteDescription(new RTCSessionDescription(payload.offer))
           ])
        } else {
           // Нет конфликта - просто принимаем
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
        if (pc) {
           if (ignoreOfferRef.current[payload.from]) {
             console.log("🙈 Ignoring answer because we marked connection as ignored")
             ignoreOfferRef.current[payload.from] = false
             return
           }
           try {
             await pc.setRemoteDescription(new RTCSessionDescription(payload.answer))
           } catch (e) {
             console.warn("Failed to set remote answer:", e)
           }
        }
      })
      .on('broadcast', { event: 'ice-candidate' }, async ({ payload }) => {
        if (payload.to !== user.id) return
        const pc = peerConnections.current[payload.from]
        try {
           // Иногда ICE приходит раньше RemoteDescription, это норма, игнорируем ошибку
           if (pc && pc.remoteDescription) {
              await pc.addIceCandidate(new RTCIceCandidate(payload.candidate))
           }
        } catch (ignored) {}
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          console.log("✅ Subscribed to signaling")
          await channel.track({ online_at: new Date().toISOString() })
          
          const state = channel.presenceState()
          for (const peerId of Object.keys(state)) {
             if (peerId === user.id || peerConnections.current[peerId]) continue 
             createPeerConnection(peerId) 
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