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
  
  // Храним активные соединения
  const peerConnections = useRef<{ [key: string]: RTCPeerConnection }>({})
  const channelRef = useRef<RealtimeChannel | null>(null)
  const supabase = createClient()

  // 1. ЗАХВАТ МИКРОФОНА (Один раз при входе)
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

    return () => {
      mounted = false
      // Не останавливаем треки здесь, чтобы не ломать переключения, 
      // но в реальном приложении можно делать cleanup
    }
  }, [user])

  // 2. СИГНАЛИЗАЦИЯ
  useEffect(() => {
    if (!roomId || !user || !localStream) return

    // Чтобы не создавать канал дважды
    if (channelRef.current) return

    console.log(`🔌 Initializing signaling for room: ${roomId}`)

    // --- ФУНКЦИЯ СОЗДАНИЯ PEER CONNECTION ---
    const createPeerConnection = (peerId: string) => {
      // ЗАЩИТА ОТ ДУБЛЕЙ: Если соединение уже есть — не создаем новое
      if (peerConnections.current[peerId]) {
        return peerConnections.current[peerId]
      }

      console.log(`🔗 Creating NEW PeerConnection with ${peerId}`)
      const pc = new RTCPeerConnection(ICE_SERVERS)
      peerConnections.current[peerId] = pc

      // Добавляем локальный звук
      localStream.getTracks().forEach((track) => {
        pc.addTrack(track, localStream)
      })

      // Когда получаем удаленный звук
      pc.ontrack = (event) => {
        console.log(`🔊 Received audio track from ${peerId}`)
        const [remoteStream] = event.streams
        setPeers((prev) => {
          if (prev.find(p => p.id === peerId)) return prev
          return [...prev, { id: peerId, stream: remoteStream }]
        })
      }

      // ICE Candidates
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          channel.send({
            type: 'broadcast',
            event: 'ice-candidate',
            payload: { candidate: event.candidate, to: peerId, from: user.id },
          })
        }
      }

      // Обработка разрыва соединения
      pc.onconnectionstatechange = () => {
        const state = pc.connectionState
        console.log(`📶 Connection state with ${peerId}: ${state}`)
        if (state === 'disconnected' || state === 'failed' || state === 'closed') {
          setPeers(prev => prev.filter(p => p.id !== peerId))
          // Удаляем из рефов, чтобы можно было переподключиться
          delete peerConnections.current[peerId]
        }
      }

      return pc
    }

    const channel = supabase.channel(`room:${roomId}`, {
      config: { presence: { key: user.id } },
    })

    channel
      .on('presence', { event: 'sync' }, () => {
        // Sync срабатывает часто. Мы используем его только для логов,
        // логика инициализации вынесена в 'join' и подписку.
        const state = channel.presenceState()
        console.log('👥 Presence Sync:', Object.keys(state).length, 'users')
      })
      .on('presence', { event: 'join' }, async ({ key }) => {
        if (key === user.id) return
        console.log(`👤 User JOINED: ${key}`)
        
        // ВАЖНО: В Mesh-сети, когда кто-то заходит, мы (старички)
        // можем инициировать соединение к нему. Это надежнее.
        const pc = createPeerConnection(key)
        const offer = await pc.createOffer()
        await pc.setLocalDescription(offer)
        
        channel.send({
          type: 'broadcast',
          event: 'offer',
          payload: { offer, to: key, from: user.id },
        })
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

        // Если нам кидают оффер, а мы уже соединены — игнор (чтобы не было лупа)
        const existingPc = peerConnections.current[payload.from]
        if (existingPc && existingPc.signalingState !== 'stable') {
           // Конфликт (Glare). Пропускаем, если наш ID больше (простая эвристика)
           // Но для простоты: просто принимаем оффер, перезаписывая старое.
           console.warn("⚠️ Re-negotiating connection...")
        }

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
          // Если уже соединены, ответ не нужен
          if (pc.signalingState === 'stable') return 
          await pc.setRemoteDescription(new RTCSessionDescription(payload.answer))
        }
      })
      .on('broadcast', { event: 'ice-candidate' }, async ({ payload }) => {
        if (payload.to !== user.id) return
        const pc = peerConnections.current[payload.from]
        if (pc && pc.remoteDescription) { // Добавляем айс только если есть Remote Description
          try {
            await pc.addIceCandidate(new RTCIceCandidate(payload.candidate))
          } catch (e) { console.warn("ICE Error", e) }
        }
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          console.log("✅ Subscribed to signaling")
          await channel.track({ online_at: new Date().toISOString() })
          
          // При входе: сканируем кто уже есть и звоним им
          const state = channel.presenceState()
          const onlineUsers = Object.keys(state)
          
          for (const peerId of onlineUsers) {
             if (peerId === user.id) continue
             // Если мы уже создали коннект (например, через join event), пропускаем
             if (peerConnections.current[peerId]) continue 

             console.log(`🚀 Calling existing user: ${peerId}`)
             const pc = createPeerConnection(peerId)
             const offer = await pc.createOffer()
             await pc.setLocalDescription(offer)
             
             channel.send({
               type: 'broadcast',
               event: 'offer',
               payload: { offer, to: peerId, from: user.id },
             })
          }
        }
      })

    channelRef.current = channel

    // CLEANUP при выходе из комнаты
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
      localStream.getAudioTracks().forEach(track => {
        track.enabled = !track.enabled
      })
      setIsMuted(!isMuted)
    }
  }

  return { peers, localStream, isMuted, toggleMute }
}