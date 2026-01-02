import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/utils/supabase/client'
import { RealtimeChannel } from '@supabase/supabase-js'

// --- АНТИ-DPI КОНФИГ (ПОЛНЫЙ СПИСОК) ---
const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun.global.stun.twilio.com:3478' },
    { urls: 'stun:stun.framasoft.org:3478' },
    { urls: 'stun:stun.stunprotocol.org:3478' },
    { urls: 'stun:stun.nextcloud.com:443' }, // Порт 443 для маскировки под HTTPS
    { urls: 'stun:stun.voip.blackberry.com:3478' },
    { urls: 'stun:stun.samsungsmartcam.com:3478' },
    { urls: 'stun:stun.services.mozilla.com:3478' }
  ],
  iceCandidatePoolSize: 10,
}

interface Peer {
  id: string
  stream: MediaStream
  username: string
}

export interface RoomUser {
  id: string
  username: string
  online_at: string
}

export interface PeerStats {
  rtt: number
  packetLoss: number
}

export function useWebRTC(roomId: string, user: any) {
  const [activeUsers, setActiveUsers] = useState<RoomUser[]>([]) 
  const [peers, setPeers] = useState<Peer[]>([])
  const [stats, setStats] = useState<{ [key: string]: PeerStats }>({})
  
  const [localStream, setLocalStream] = useState<MediaStream | null>(null)
  const [isScreenSharing, setIsScreenSharing] = useState(false)
  const [isMuted, setIsMuted] = useState(false)
  
  const peerConnections = useRef<{ [key: string]: RTCPeerConnection }>({})
  const peerUsernames = useRef<{ [key: string]: string }>({}) 
  const channelRef = useRef<RealtimeChannel | null>(null)
  const screenTrackRef = useRef<MediaStreamTrack | null>(null)
  
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
        console.warn("⚠️ No microphone found. Joining in Listen-Only mode.")
        if (mounted) setLocalStream(new MediaStream()) 
      }
    }
    initMedia()
    return () => { mounted = false }
  }, [user])

  // 2. МОНИТОРИНГ СЕТИ (ПИНГ)
  useEffect(() => {
    const interval = setInterval(async () => {
      const newStats: { [key: string]: PeerStats } = {}
      
      for (const [peerId, pc] of Object.entries(peerConnections.current)) {
        try {
          const statsReport = await pc.getStats()
          statsReport.forEach(report => {
            if (report.type === 'candidate-pair' && report.state === 'succeeded') {
              const rtt = Math.round(report.currentRoundTripTime * 1000) || 0
              newStats[peerId] = { rtt, packetLoss: 0 }
            }
          })
        } catch (e) {
          console.warn("Stats error", e)
        }
      }
      
      if (Object.keys(newStats).length > 0) {
        setStats(prev => ({ ...prev, ...newStats }))
      }
    }, 2000)

    return () => clearInterval(interval)
  }, [])

  // 3. ЭКРАН
  const toggleScreenShare = async () => {
    if (isScreenSharing) {
      stopScreenShare()
    } else {
      try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
        const screenTrack = screenStream.getVideoTracks()[0]
        
        screenTrackRef.current = screenTrack
        setIsScreenSharing(true)

        Object.values(peerConnections.current).forEach(pc => {
          if (localStream) pc.addTrack(screenTrack, localStream) 
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

  // 4. СИГНАЛИЗАЦИЯ
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

      const tracks = localStream.getTracks()
      tracks.forEach((track) => pc.addTrack(track, localStream))
      
      if (tracks.length === 0) {
          pc.addTransceiver('audio', { direction: 'recvonly' })
      }

      if (screenTrackRef.current) {
        pc.addTrack(screenTrackRef.current, localStream)
      }

      pc.onnegotiationneeded = async () => {
        try {
          makingOfferRef.current[peerId] = true
          const offer = await pc.createOffer()
          if (pc.signalingState !== 'stable') return 
          await pc.setLocalDescription(offer)
          
          channel.send({
             type: 'broadcast',
             event: 'offer',
             payload: { offer, to: peerId, from: user.id },
          })
        } catch (err) {
          console.error("Negotiation error:", err)
        } finally {
          makingOfferRef.current[peerId] = false
        }
      }

      pc.ontrack = (event) => {
        const [remoteStream] = event.streams
        // Имя берем из activeUsers, тут заглушка
        const name = 'Peer' 
        
        setPeers((prev) => {
          const existing = prev.find(p => p.id === peerId)
          if (existing) return prev.map(p => p.id === peerId ? { ...p, stream: remoteStream } : p)
          return [...prev, { id: peerId, stream: remoteStream, username: name }]
        })

        remoteStream.onremovetrack = () => {
           setPeers((prev) => {
             return prev.map(p => {
               if (p.id === peerId) {
                 const newStream = new MediaStream(remoteStream.getTracks())
                 return { ...p, stream: newStream }
               }
               return p
             })
           })
        }
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
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState()
        const users: RoomUser[] = []
        for (const key in state) {
            // @ts-ignore
            const userData = state[key][0] as any
            if (userData) {
                users.push({
                    id: key,
                    username: userData.username || 'Unknown',
                    online_at: userData.online_at
                })
            }
        }
        setActiveUsers(users)
      })
      .on('presence', { event: 'join' }, ({ key }) => {
        if (key === user.id) return
        createPeerConnection(key)
      })
      .on('presence', { event: 'leave' }, ({ key }) => {
        if (peerConnections.current[key]) {
           peerConnections.current[key].close()
           delete peerConnections.current[key]
        }
      })
      .on('broadcast', { event: 'offer' }, async ({ payload }) => {
        if (payload.to !== user.id) return
        const pc = createPeerConnection(payload.from)
        
        const polite = user.id.localeCompare(payload.from) < 0 
        const offerCollision = makingOfferRef.current[payload.from] || pc.signalingState !== 'stable'

        if (offerCollision) {
           if (!polite) {
             ignoreOfferRef.current[payload.from] = true
             return 
           }
           await Promise.all([
             pc.setLocalDescription({ type: "rollback" }),
             pc.setRemoteDescription(new RTCSessionDescription(payload.offer))
           ])
        } else {
           await pc.setRemoteDescription(new RTCSessionDescription(payload.offer))
        }

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
        const pc = peerConnections.current[payload.from]
        if (pc) {
           if (ignoreOfferRef.current[payload.from]) {
             ignoreOfferRef.current[payload.from] = false
             return
           }
           try {
             await pc.setRemoteDescription(new RTCSessionDescription(payload.answer))
           } catch (e) { console.warn(e) }
        }
      })
      .on('broadcast', { event: 'ice-candidate' }, async ({ payload }) => {
        if (payload.to !== user.id) return
        const pc = peerConnections.current[payload.from]
        try {
           if (pc && pc.remoteDescription) await pc.addIceCandidate(new RTCIceCandidate(payload.candidate))
        } catch (ignored) {}
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          console.log("✅ Subscribed to signaling")
          await channel.track({ 
              online_at: new Date().toISOString(),
              username: user.email 
          })
          
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
      setActiveUsers([])
      setStats({})
    }
  }, [roomId, user, localStream])

  const toggleMute = () => {
    if (localStream) {
      localStream.getAudioTracks().forEach(track => { track.enabled = !track.enabled })
      setIsMuted(!isMuted)
    }
  }

  return { activeUsers, peers, localStream, isMuted, toggleMute, isScreenSharing, toggleScreenShare, stats }
}