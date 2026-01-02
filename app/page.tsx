'use client'

import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/utils/supabase/client'
import { useWebRTC } from '@/hooks/useWebRTC'
import { 
  Mic, MicOff, Hash, LogOut, Send, 
  Plus, Radio, User, Monitor, MonitorX, Phone, PhoneOff 
} from 'lucide-react'
import clsx from 'clsx'

// --- TYPES ---
type Room = { id: string; name: string; created_by: string }
type Message = { id: string; content: string; user_id: string; created_at: string; profiles?: { username: string } }

// 1. AUDIO/VIDEO RENDERER
const MediaRenderer = ({ stream, isLocal = false }: { stream: MediaStream, isLocal?: boolean }) => {
  const videoRef = useRef<HTMLVideoElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const hasVideo = stream.getVideoTracks().length > 0

  useEffect(() => {
    if (hasVideo && videoRef.current) videoRef.current.srcObject = stream
    else if (audioRef.current) audioRef.current.srcObject = stream
  }, [stream, hasVideo])

  if (hasVideo) return <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover rounded-lg bg-black" />
  return <audio ref={audioRef} autoPlay muted={isLocal} />
}

// 2. VOICE CONTROLS (ВЫНЕСЛИ НАРУЖУ)
function VoiceControls({ room, user, onDisconnect }: { room: Room, user: any, onDisconnect: () => void }) {
    // Вызываем хук с isEnabled = true, так как компонент рендерится только при входе
    const { peers, localStream, isMuted, toggleMute, isScreenSharing, toggleScreenShare } = useWebRTC(room.id, user, true)

    const videoPeers = peers.filter(p => p.stream.getVideoTracks().length > 0)
    const iAmStreaming = localStream && localStream.getVideoTracks().length > 0

    return (
      <div className="flex flex-col animate-in fade-in slide-in-from-bottom-4 duration-300">
        {/* VIDEO STAGE */}
        {(videoPeers.length > 0 || iAmStreaming) && (
            <div className="p-4 bg-black/40 border-b border-zinc-800/50 grid grid-cols-1 md:grid-cols-2 gap-4 max-h-[45vh] overflow-y-auto">
                 {iAmStreaming && localStream && (
                     <div className="relative aspect-video bg-zinc-900 rounded-xl overflow-hidden border border-indigo-500 shadow-2xl">
                        <MediaRenderer stream={localStream} isLocal={true} />
                        <div className="absolute bottom-2 left-2 bg-black/60 px-2 py-1 rounded text-[10px] text-white font-bold uppercase tracking-widest">Your Stream</div>
                     </div>
                 )}
                 {videoPeers.map(peer => (
                     <div key={peer.id} className="relative aspect-video bg-zinc-900 rounded-xl overflow-hidden border border-zinc-700 shadow-xl">
                        <MediaRenderer stream={peer.stream} />
                        <div className="absolute bottom-2 left-2 bg-black/60 px-2 py-1 rounded text-[10px] text-white font-bold uppercase tracking-widest">
                            {peer.username?.split('@')[0]}
                        </div>
                     </div>
                 ))}
            </div>
        )}

        {/* CONTROLS BAR */}
        <div className="bg-indigo-500/10 border-t border-b border-indigo-500/20 backdrop-blur-md p-3">
            <div className="flex items-center justify-between mb-3 px-1">
              <div className="flex items-center gap-2.5">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
                <span className="text-emerald-400 text-[10px] font-bold uppercase tracking-[0.2em]">Voice Active</span>
              </div>
              
              <div className="flex gap-2">
                  <button onClick={toggleScreenShare} title="Share Screen"
                    className={clsx("p-2 rounded-lg transition-all", isScreenSharing ? "bg-indigo-500 text-white shadow-lg shadow-indigo-500/20" : "bg-zinc-800 hover:bg-zinc-700 text-zinc-300")}>
                    {isScreenSharing ? <MonitorX size={16} /> : <Monitor size={16} />}
                  </button>

                  <button onClick={toggleMute} title="Mute"
                    className={clsx("p-2 rounded-lg transition-all", isMuted ? "bg-red-500/20 text-red-400" : "bg-zinc-800 hover:bg-zinc-700 text-white")}>
                    {isMuted ? <MicOff size={16} /> : <Mic size={16} />}
                  </button>

                  <button onClick={onDisconnect} title="Disconnect"
                    className="p-2 rounded-lg bg-red-600 hover:bg-red-500 text-white transition-all shadow-lg shadow-red-900/20">
                    <PhoneOff size={16} />
                  </button>
              </div>
            </div>
            
            {/* User Bubbles */}
            <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide px-1">
               <div className="flex flex-col items-center gap-1.5 min-w-[50px] group">
                 <div className="w-10 h-10 rounded-full bg-zinc-800 border-2 border-emerald-500/50 flex items-center justify-center relative overflow-hidden transition-transform group-hover:scale-105">
                    {user.email?.[0].toUpperCase()}
                    {isMuted && <div className="absolute inset-0 bg-red-500/40 flex items-center justify-center"><MicOff size={12}/></div>}
                 </div>
                 <span className="text-[9px] text-zinc-500 font-bold uppercase tracking-tighter">You</span>
               </div>

               {peers.map(peer => (
                 <div key={peer.id} className="flex flex-col items-center gap-1.5 min-w-[50px] animate-in zoom-in-75 duration-300">
                    <div className="w-10 h-10 rounded-full bg-indigo-900/40 border-2 border-indigo-500/50 flex items-center justify-center relative overflow-hidden shadow-lg shadow-indigo-500/10">
                      <span className="text-xs font-black text-indigo-300 z-10">{peer.username?.[0].toUpperCase()}</span>
                      {peer.stream.getVideoTracks().length === 0 && <MediaRenderer stream={peer.stream} />}
                    </div>
                    <span className="text-[9px] text-zinc-400 font-bold uppercase truncate max-w-[60px] tracking-tighter">
                        {peer.username?.split('@')[0]}
                    </span>
                 </div>
               ))}
            </div>
        </div>
      </div>
    )
}

// 3. AUTH SCREEN (Minimal change)
function AuthScreen({ onLogin }: { onLogin: () => void }) {
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const supabase = createClient()
  const handleAuth = async (type: 'login' | 'register') => {
    const { error } = type === 'login' ? await supabase.auth.signInWithPassword({ email, password }) : await supabase.auth.signUp({ email, password })
    if (error) alert(error.message); else onLogin()
  }
  return (
    <div className="flex items-center justify-center h-screen bg-[#09090b] text-zinc-100">
      <div className="w-full max-w-md p-10 space-y-8 bg-zinc-900/40 rounded-3xl border border-zinc-800/50 backdrop-blur-2xl shadow-2xl text-center">
        <Radio className="mx-auto text-indigo-500 mb-2" size={40} />
        <h1 className="text-3xl font-black tracking-tight">NetherCord</h1>
        <div className="space-y-4">
          <input className="w-full px-5 py-4 bg-black/40 border border-zinc-800 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} />
          <input className="w-full px-5 py-4 bg-black/40 border border-zinc-800 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all" type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} />
        </div>
        <div className="flex gap-3">
          <button onClick={() => handleAuth('login')} className="flex-1 py-4 bg-indigo-600 hover:bg-indigo-500 rounded-xl font-bold transition-all shadow-lg shadow-indigo-500/20">Login</button>
          <button onClick={() => handleAuth('register')} className="flex-1 py-4 bg-zinc-800 hover:bg-zinc-700 rounded-xl font-bold transition-all">Register</button>
        </div>
      </div>
    </div>
  )
}

// 4. MAIN APP
export default function DiscordLite() {
  const [user, setUser] = useState<any>(null); const [rooms, setRooms] = useState<Room[]>([]);
  const [currentRoom, setCurrentRoom] = useState<Room | null>(null); const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [isInVoice, setIsInVoice] = useState(false); // <--- СОСТОЯНИЕ ГОЛОСА
  
  const supabase = createClient(); const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user))
    supabase.from('rooms').select('*').then(({ data }) => data && setRooms(data))
  }, [])

  useEffect(() => {
    if (!currentRoom) return
    setIsInVoice(false) // При смене комнаты всегда выходим из ГС
    supabase.from('messages').select('*, profiles(username)').eq('room_id', currentRoom.id).order('created_at', { ascending: true }).then(({ data }) => data && setMessages(data as any))
    const channel = supabase.channel(`chat:${currentRoom.id}`).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `room_id=eq.${currentRoom.id}` }, async (p) => {
        const { data } = await supabase.from('profiles').select('username').eq('id', p.new.user_id).single()
        setMessages(prev => [...prev, { ...p.new, profiles: data } as any])
    }).subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [currentRoom])

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }) }, [messages])

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault(); if (!newMessage.trim() || !user || !currentRoom) return
    await supabase.from('messages').insert({ room_id: currentRoom.id, user_id: user.id, content: newMessage })
    setNewMessage('')
  }

  if (!user) return <AuthScreen onLogin={() => window.location.reload()} />

  return (
    <div className="flex h-screen bg-[#09090b] text-zinc-100 overflow-hidden font-sans">
      <aside className="w-72 bg-[#0c0c0e] flex flex-col border-r border-zinc-800/50">
        <div className="h-14 flex items-center px-6 border-b border-zinc-800/50"><span className="font-black text-lg tracking-tighter flex items-center gap-2"><Radio className="text-indigo-500" size={18} />NETHERCORD</span></div>
        <div className="flex-1 overflow-y-auto p-4 space-y-1">
          {rooms.map(room => (
            <button key={room.id} onClick={() => setCurrentRoom(room)} className={clsx("w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-bold transition-all", currentRoom?.id === room.id ? "bg-indigo-600 text-white shadow-lg shadow-indigo-600/20" : "text-zinc-500 hover:bg-zinc-800/40 hover:text-zinc-300")}>
              <Hash size={16} /> <span className="truncate">{room.name}</span>
            </button>
          ))}
        </div>
        <div className="p-4 bg-black/20 border-t border-zinc-800/50">
           <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-indigo-500 flex items-center justify-center text-xs font-black shadow-lg shadow-indigo-500/20">{user.email?.[0].toUpperCase()}</div>
              <div className="flex-1 min-w-0"><div className="text-xs font-bold truncate">{user.email?.split('@')[0]}</div><div className="text-[10px] text-emerald-500 font-bold uppercase tracking-widest opacity-70">Online</div></div>
              <button onClick={() => supabase.auth.signOut().then(() => setUser(null))} className="text-zinc-600 hover:text-red-400"><LogOut size={16} /></button>
           </div>
        </div>
      </aside>

      <main className="flex-1 flex flex-col min-w-0 bg-[#09090b]">
        {currentRoom ? (
          <>
            <header className="h-14 border-b border-zinc-800/50 flex items-center justify-between px-8 bg-[#09090b]/50 backdrop-blur-xl sticky top-0 z-10">
              <div className="flex items-center gap-2 font-black tracking-tight"><Hash className="text-zinc-600" size={18} />{currentRoom.name}</div>
              
              {/* КНОПКА JOIN VOICE В ХЕДЕРЕ */}
              {!isInVoice && (
                <button onClick={() => setIsInVoice(true)} className="flex items-center gap-2 px-4 py-1.5 bg-indigo-500/10 hover:bg-indigo-500 text-indigo-400 hover:text-white border border-indigo-500/30 rounded-full text-xs font-black transition-all group">
                   <Phone size={14} className="group-hover:animate-bounce" /> JOIN VOICE
                </button>
              )}
            </header>
            
            <div className="flex-1 overflow-y-auto p-8 space-y-8">
              {messages.map((msg) => (
                <div key={msg.id} className={clsx("flex gap-5", msg.user_id === user.id && "flex-row-reverse")}>
                   <div className="w-10 h-10 rounded-2xl bg-zinc-800 border border-zinc-700/50 flex items-center justify-center text-zinc-500 text-xs font-black shrink-0">{msg.profiles?.username?.[0].toUpperCase()}</div>
                   <div className={clsx("flex flex-col", msg.user_id === user.id ? "items-end" : "items-start")}>
                      <div className="flex items-baseline gap-2 mb-1.5"><span className="font-black text-xs text-zinc-400">{msg.profiles?.username?.split('@')[0]}</span><span className="text-[10px] text-zinc-600 font-bold">{new Date(msg.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span></div>
                      <div className={clsx("px-5 py-3 rounded-2xl text-[14px] font-medium leading-relaxed shadow-sm", msg.user_id === user.id ? "bg-indigo-600 text-white rounded-tr-none" : "bg-zinc-800/50 text-zinc-200 rounded-tl-none border border-zinc-800/50")}>{msg.content}</div>
                   </div>
                </div>
              ))}
              <div ref={messagesEndRef} className="h-4" />
            </div>

            <div className="px-6 pb-8">
              <div className="bg-zinc-900/40 border border-zinc-800/60 rounded-3xl overflow-hidden shadow-2xl backdrop-blur-xl">
                {/* РЕНДЕРИМ ВОЙС ТОЛЬКО ЕСЛИ isInVoice === true */}
                {isInVoice && (
                    <VoiceControls room={currentRoom} user={user} onDisconnect={() => setIsInVoice(false)} />
                )}

                <form onSubmit={sendMessage} className="p-3 flex items-center gap-3">
                  <input className="flex-1 bg-transparent text-white placeholder:text-zinc-700 px-4 py-3 outline-none font-bold text-sm" placeholder={`Message #${currentRoom.name}`} value={newMessage} onChange={e => setNewMessage(e.target.value)} />
                  <button type="submit" disabled={!newMessage.trim()} className="p-3 text-indigo-500 hover:bg-indigo-500/10 rounded-2xl disabled:opacity-30 transition-all"><Send size={20} /></button>
                </form>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-zinc-600 font-black uppercase tracking-[0.3em] text-xs">Select a channel</div>
        )}
      </main>
    </div>
  )
}