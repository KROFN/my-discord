'use client'

import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/utils/supabase/client'
import { useWebRTC } from '@/hooks/useWebRTC'
import { 
  Mic, MicOff, Hash, LogOut, Send, 
  Plus, Radio, User, Monitor, MonitorX,
  Phone, PhoneOff, Video // <--- Новые иконки
} from 'lucide-react'
import clsx from 'clsx'

// --- TYPES ---
type Room = { id: string; name: string; created_by: string }
type Message = { id: string; content: string; user_id: string; created_at: string; profiles?: { username: string } }

// --- COMPONENTS ---

// 1. LOGIN SCREEN
function AuthScreen({ onLogin }: { onLogin: () => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const supabase = createClient()

  const handleAuth = async (type: 'login' | 'register') => {
    setLoading(true)
    const { error } = type === 'login' 
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({ email, password })
    
    if (error) alert(error.message)
    else onLogin()
    setLoading(false)
  }

  return (
    <div className="flex items-center justify-center h-screen bg-[#09090b] text-zinc-100">
      <div className="w-full max-w-md p-8 space-y-8 bg-zinc-900/50 rounded-2xl border border-zinc-800 shadow-2xl backdrop-blur-xl">
        <div className="text-center space-y-2">
          <div className="mx-auto w-12 h-12 bg-indigo-500 rounded-xl flex items-center justify-center text-white shadow-lg shadow-indigo-500/20">
            <Radio size={24} />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">NetherCord</h1>
          <p className="text-zinc-400 text-sm">P2P, Zero-censorship, Zero-cost.</p>
        </div>
        <div className="space-y-4">
          <input className="w-full px-4 py-3 bg-zinc-950/50 border border-zinc-800 rounded-lg text-white outline-none focus:ring-2 focus:ring-indigo-500/50" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} />
          <input className="w-full px-4 py-3 bg-zinc-950/50 border border-zinc-800 rounded-lg text-white outline-none focus:ring-2 focus:ring-indigo-500/50" type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} />
        </div>
        <div className="flex gap-3 pt-2">
          <button onClick={() => handleAuth('login')} disabled={loading} className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-medium transition-all active:scale-95 disabled:opacity-50">Login</button>
          <button onClick={() => handleAuth('register')} disabled={loading} className="flex-1 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg font-medium transition-all active:scale-95 disabled:opacity-50">Register</button>
        </div>
      </div>
    </div>
  )
}

// 2. MEDIA RENDERER
const MediaRenderer = ({ stream, isLocal = false }: { stream: MediaStream, isLocal?: boolean }) => {
  const videoRef = useRef<HTMLVideoElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const hasVideo = stream.getVideoTracks().length > 0

  useEffect(() => {
    if (hasVideo && videoRef.current) {
        videoRef.current.srcObject = stream
    } else if (audioRef.current) {
        audioRef.current.srcObject = stream
    }
  }, [stream, hasVideo])

  if (hasVideo) {
      return <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover rounded-lg bg-black" />
  }
  return <audio ref={audioRef} autoPlay muted={isLocal} />
}

// 3. VOICE CONTROLS (С КНОПКОЙ ВЫХОДА)
function VoiceControls({ room, user, onDisconnect }: { room: Room, user: any, onDisconnect: () => void }) {
    // Достаем stats
    const { activeUsers, peers, localStream, isMuted, toggleMute, isScreenSharing, toggleScreenShare, stats } = useWebRTC(room.id, user)
    
    // ... videoPeers и iAmStreaming без изменений ...
    const videoPeers = peers.filter(p => p.stream.getVideoTracks().length > 0)
    const iAmStreaming = localStream && localStream.getVideoTracks().length > 0

    return (
      <div className="flex flex-col animate-in slide-in-from-bottom duration-300">
        
        {/* VIDEO GRID ... (без изменений) ... */}
        {(videoPeers.length > 0 || iAmStreaming) && (
            <div className="p-4 bg-[#09090b] border-b border-zinc-800 grid grid-cols-1 md:grid-cols-2 gap-4 max-h-[50vh] overflow-y-auto">
                 {iAmStreaming && localStream && (
                     <div className="relative aspect-video bg-zinc-900 rounded-xl overflow-hidden border border-indigo-500/50">
                        <MediaRenderer stream={localStream} isLocal={true} />
                        <div className="absolute bottom-2 left-2 bg-black/60 px-2 py-1 rounded text-[10px] text-white">You (Screen)</div>
                     </div>
                 )}
                 {videoPeers.map(peer => {
                    const userInfo = activeUsers.find(u => u.id === peer.id)
                    const name = userInfo ? userInfo.username.split('@')[0] : 'Peer'
                    return (
                     <div key={peer.id} className="relative aspect-video bg-zinc-900 rounded-xl overflow-hidden border border-zinc-700 shadow-lg">
                        <MediaRenderer stream={peer.stream} />
                        <div className="absolute bottom-2 left-2 bg-black/60 px-2 py-1 rounded text-[10px] text-white">{name}</div>
                     </div>
                 )})}
            </div>
        )}

        <div className="bg-emerald-950/20 border-t border-b border-emerald-900/30 backdrop-blur-md p-3">
            {/* ... Кнопки управления ... */}
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2.5">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
                <span className="text-emerald-400 text-[10px] font-bold uppercase tracking-widest">Voice Live</span>
              </div>
              
              <div className="flex gap-2">
                  <button onClick={toggleScreenShare} className={clsx("p-2 rounded-lg transition-all", isScreenSharing ? "bg-indigo-600 text-white shadow-lg" : "bg-zinc-800 text-zinc-400 hover:text-white")}>
                    {isScreenSharing ? <MonitorX size={16} /> : <Monitor size={16} />}
                  </button>
                  <button onClick={toggleMute} className={clsx("p-2 rounded-lg transition-all", isMuted ? "bg-red-500/20 text-red-400" : "bg-zinc-800 text-white")}>
                    {isMuted ? <MicOff size={16} /> : <Mic size={16} />}
                  </button>
                  <button onClick={onDisconnect} className="p-2 bg-red-600 hover:bg-red-500 text-white rounded-lg transition-all active:scale-95 shadow-lg shadow-red-900/20">
                    <PhoneOff size={16} />
                  </button>
              </div>
            </div>
            
            {/* СПИСОК ЮЗЕРОВ СО СТАТИСТИКОЙ */}
            <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
               {activeUsers.map(u => {
                 const isMe = u.id === user.id
                 const peerData = peers.find(p => p.id === u.id)
                 const hasAudio = peerData && peerData.stream.getAudioTracks().length > 0
                 
                 // Достаем пинг для этого юзера
                 const userStats = stats[u.id]
                 const ping = userStats?.rtt || 0
                 
                 // Цвет пинга
                 const pingColor = ping < 100 ? "text-emerald-500" : ping < 300 ? "text-yellow-500" : "text-red-500"

                 return (
                 <div key={u.id} className="flex flex-col items-center gap-1 min-w-[45px] group relative">
                    {/* Tooltip с пингом (показываем при наведении, если не я) */}
                    {!isMe && ping > 0 && (
                        <div className="absolute -top-6 bg-black text-[9px] px-1.5 py-0.5 rounded text-white opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-20">
                            {ping}ms
                        </div>
                    )}

                    <div className={clsx(
                        "w-9 h-9 rounded-full border-2 flex items-center justify-center relative overflow-hidden text-xs font-bold transition-all",
                        isMe ? "bg-zinc-800 border-emerald-500/50" : "bg-indigo-900/40 border-indigo-500/50"
                    )}>
                      <span className={clsx("z-10", isMe ? "text-white" : "text-indigo-300")}>
                          {u.username[0].toUpperCase()}
                      </span>
                      
                      {!isMe && peerData && peerData.stream.getVideoTracks().length === 0 && (
                          <MediaRenderer stream={peerData.stream} />
                      )}

                      {!isMe && !hasAudio && (
                          <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                              <MicOff size={10} className="text-zinc-500" />
                          </div>
                      )}
                    </div>
                    
                    {/* Имя и иконка пинга */}
                    <div className="flex items-center gap-0.5 max-w-[50px]">
                        <span className="text-[9px] text-zinc-400 font-medium truncate flex-1">
                            {isMe ? 'You' : u.username.split('@')[0]}
                        </span>
                        {/* Показываем палочки сигнала */}
                        {!isMe && ping > 0 && (
                             <Signal size={8} className={pingColor} />
                        )}
                    </div>
                 </div>
               )})}
            </div>
        </div>
      </div>
    )
}

// 4. MAIN APP
export default function DiscordLite() {
  const [user, setUser] = useState<any>(null)
  const [rooms, setRooms] = useState<Room[]>([])
  const [currentRoom, setCurrentRoom] = useState<Room | null>(null)
  const [isInVoice, setIsInVoice] = useState(false) // <--- НОВЫЙ СТЕЙТ
  const [messages, setMessages] = useState<Message[]>([])
  const [newMessage, setNewMessage] = useState('')
  
  const supabase = createClient()
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const getUser = async () => {
      const { data } = await supabase.auth.getUser()
      if (data.user) setUser(data.user)
    }
    getUser()

    const getRooms = async () => {
      const { data } = await supabase.from('rooms').select('*')
      if (data) setRooms(data)
    }
    getRooms()

    const channel = supabase.channel('room_updates').on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'rooms' }, (payload) => {
        setRooms(prev => [...prev, payload.new as Room])
    }).subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [])

  useEffect(() => {
    if (!currentRoom) return
    setIsInVoice(false) // Выключаем гс при смене комнаты

    const fetchMessages = async () => {
      const { data } = await supabase.from('messages').select('*, profiles(username)').eq('room_id', currentRoom.id).order('created_at', { ascending: true })
      if (data) setMessages(data as any)
    }
    fetchMessages()

    const channel = supabase.channel(`chat:${currentRoom.id}`).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `room_id=eq.${currentRoom.id}` }, async (payload) => {
        const { data: userData } = await supabase.from('profiles').select('username').eq('id', payload.new.user_id).single()
        setMessages(prev => [...prev, { ...payload.new, profiles: userData } as any])
    }).subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [currentRoom])

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }) }, [messages])

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newMessage.trim() || !user || !currentRoom) return
    await supabase.from('messages').insert({ room_id: currentRoom.id, user_id: user.id, content: newMessage })
    setNewMessage('')
  }

  if (!user) return <AuthScreen onLogin={() => window.location.reload()} />

  return (
    <div className="flex h-screen bg-[#09090b] text-zinc-100 overflow-hidden font-sans">
      
      {/* SIDEBAR */}
      <aside className="w-72 bg-[#0c0c0e] flex flex-col border-r border-zinc-800/60 shadow-xl z-20">
        <div className="h-14 flex items-center px-4 border-b border-zinc-800/60 bg-[#0c0c0e]">
          <span className="font-bold text-lg tracking-tight flex items-center gap-2">
            <Radio className="text-indigo-500" size={20} />
            NetherCord
          </span>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-1">
          <div className="text-xs font-semibold text-zinc-500 uppercase px-2 mb-2 tracking-wider">Rooms</div>
          {rooms.map(room => (
            <button key={room.id} onClick={() => setCurrentRoom(room)}
              className={clsx("w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all group", currentRoom?.id === room.id ? "bg-zinc-800 text-white shadow-sm" : "text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200")}>
              <Hash size={16} className={currentRoom?.id === room.id ? "text-indigo-400" : "text-zinc-600 group-hover:text-zinc-400"} />
              <span className="truncate">{room.name}</span>
            </button>
          ))}
          <button onClick={() => {
              const name = prompt("Enter room name:")
              if (name) supabase.from('rooms').insert({ name, created_by: user.id })
          }} className="w-full flex items-center gap-2 px-3 py-2 mt-4 text-xs font-medium text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/30 rounded-lg transition-colors border border-dashed border-zinc-800 hover:border-zinc-700">
            <Plus size={14} /> <span>Create Room</span>
          </button>
        </div>

        <div className="p-3 bg-[#09090b] border-t border-zinc-800/60">
           <div className="flex items-center gap-3 p-2 rounded-lg">
              <div className="w-9 h-9 rounded-full bg-gradient-to-tr from-indigo-500 to-purple-500 flex items-center justify-center text-sm font-bold shadow-lg shadow-indigo-500/20 text-white shrink-0">
                 {user.email?.[0].toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-white truncate">{user.email?.split('@')[0]}</div>
                <div className="text-[10px] text-emerald-500 font-bold uppercase tracking-widest">Online</div>
              </div>
              <button onClick={() => supabase.auth.signOut().then(() => setUser(null))} className="p-1.5 text-zinc-500 hover:text-red-400 hover:bg-red-500/10 rounded-md transition-all">
                <LogOut size={16} />
              </button>
           </div>
        </div>
      </aside>

      {/* MAIN CHAT AREA */}
      <main className="flex-1 flex flex-col min-w-0 bg-[#09090b] relative">
        {currentRoom ? (
          <>
            <header className="h-14 border-b border-zinc-800/60 flex items-center justify-between px-6 bg-[#09090b]/80 backdrop-blur-md sticky top-0 z-10">
              <div className="flex items-center">
                <Hash className="mr-3 text-zinc-500" size={20} />
                <span className="font-bold text-white tracking-tight">{currentRoom.name}</span>
              </div>
              
              {/* КНОПКА JOIN VOICE В ХЕДЕРЕ */}
              {!isInVoice && (
                  <button onClick={() => setIsInVoice(true)} className="flex items-center gap-2 px-3 py-1.5 bg-emerald-600/10 hover:bg-emerald-600 text-emerald-500 hover:text-white rounded-lg text-xs font-bold transition-all active:scale-95">
                    <Phone size={14} /> Join Voice
                  </button>
              )}
            </header>
            
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {messages.map((msg) => {
                const isMe = msg.user_id === user.id
                return (
                  <div key={msg.id} className={clsx("flex gap-4 group", isMe && "flex-row-reverse")}>
                     <div className="w-10 h-10 rounded-full bg-zinc-800 flex items-center justify-center text-zinc-400 text-sm font-bold shrink-0 mt-0.5 border border-zinc-800">
                        {msg.profiles?.username?.[0].toUpperCase() || '?'}
                     </div>
                     <div className={clsx("flex flex-col max-w-[70%]", isMe ? "items-end" : "items-start")}>
                        <div className="flex items-baseline gap-2 mb-1 text-xs">
                          <span className={clsx("font-semibold", isMe ? "text-indigo-400" : "text-zinc-300")}>{msg.profiles?.username || 'Unknown'}</span>
                          <span className="text-zinc-600 text-[10px]">{new Date(msg.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                        </div>
                        <div className={clsx("px-4 py-2 rounded-2xl text-sm shadow-sm", isMe ? "bg-indigo-600 text-white rounded-tr-sm" : "bg-zinc-800/70 text-zinc-200 rounded-tl-sm border border-zinc-800")}>
                          {msg.content}
                        </div>
                     </div>
                  </div>
                )
              })}
              <div ref={messagesEndRef} className="h-4" />
            </div>

            <div className="bg-[#09090b] px-4 pb-6 pt-2">
              <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl overflow-hidden shadow-2xl transition-all">
                {/* VOICE CONTROLS (Только если isInVoice) */}
                {isInVoice && (
                    <VoiceControls room={currentRoom} user={user} onDisconnect={() => setIsInVoice(false)} />
                )}

                <form onSubmit={sendMessage} className="relative p-2 flex items-center gap-2">
                  <button type="button" className="p-2 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 rounded-full">
                    <Plus size={20} />
                  </button>
                  <input className="flex-1 bg-transparent text-zinc-200 placeholder:text-zinc-700 px-2 py-3 outline-none font-medium text-sm" placeholder={`Message #${currentRoom.name}`} value={newMessage} onChange={e => setNewMessage(e.target.value)} />
                  <button type="submit" disabled={!newMessage.trim()} className="p-2 text-indigo-500 hover:bg-indigo-500/10 rounded-lg transition-all disabled:opacity-50"><Send size={18} /></button>
                </form>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-zinc-600 space-y-4">
            <Radio size={48} className="opacity-10" />
            <p className="font-medium text-sm">Select a room to start.</p>
          </div>
        )}
      </main>
    </div>
  )
}