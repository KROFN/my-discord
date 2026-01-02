'use client'

import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/utils/supabase/client'
import { useWebRTC } from '@/hooks/useWebRTC'
import { 
  Mic, MicOff, Hash, LogOut, Send, 
  Plus, Radio, User, MonitorCheck 
} from 'lucide-react'
import clsx from 'clsx'

// --- TYPES ---
type Profile = { id: string; username: string }
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
    <div className="flex items-center justify-center h-screen bg-[#09090b] text-zinc-100 selection:bg-indigo-500/30">
      <div className="w-full max-w-md p-8 space-y-8 bg-zinc-900/50 rounded-2xl border border-zinc-800 shadow-2xl backdrop-blur-xl">
        <div className="text-center space-y-2">
          <div className="mx-auto w-12 h-12 bg-indigo-500 rounded-xl flex items-center justify-center text-white shadow-lg shadow-indigo-500/20">
            <Radio size={24} />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Welcome Back</h1>
          <p className="text-zinc-400 text-sm">Enter the void without censorship.</p>
        </div>
        
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-xs font-medium text-zinc-500 uppercase">Email</label>
            <input 
              className="w-full px-4 py-3 bg-zinc-950/50 border border-zinc-800 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 transition-all placeholder:text-zinc-700" 
              placeholder="name@example.com" 
              value={email} 
              onChange={e => setEmail(e.target.value)} 
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-medium text-zinc-500 uppercase">Password</label>
            <input 
              className="w-full px-4 py-3 bg-zinc-950/50 border border-zinc-800 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 transition-all placeholder:text-zinc-700" 
              type="password" 
              placeholder="••••••••" 
              value={password} 
              onChange={e => setPassword(e.target.value)} 
            />
          </div>
        </div>

        <div className="flex gap-3 pt-2">
          <button onClick={() => handleAuth('login')} disabled={loading}
            className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-medium transition-all shadow-lg shadow-indigo-900/20 active:scale-95 disabled:opacity-50">
            Login
          </button>
          <button onClick={() => handleAuth('register')} disabled={loading}
            className="flex-1 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg font-medium transition-all active:scale-95 disabled:opacity-50">
            Register
          </button>
        </div>
      </div>
    </div>
  )
}

// 2. AUDIO PLAYER (Helper)
const AudioPlayer = ({ stream }: { stream: MediaStream }) => {
  const ref = useRef<HTMLAudioElement>(null)
  useEffect(() => {
    if (ref.current && stream) ref.current.srcObject = stream
  }, [stream])
  return <audio ref={ref} autoPlay />
}

// 3. VOICE CONTROLS
function VoiceControls({ room, user }: { room: Room, user: any }) {
    const { peers, localStream, isMuted, toggleMute } = useWebRTC(room.id, user)

    return (
      <div className="bg-emerald-950/30 border-t border-b border-emerald-900/50 backdrop-blur-sm p-3">
        {/* ... верхняя часть без изменений ... */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2.5">
            <span className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
            </span>
            <div className="flex flex-col">
              <span className="text-emerald-400 text-xs font-bold uppercase tracking-wider">Voice Connected</span>
              <span className="text-emerald-500/60 text-[10px] font-mono">P2P MESH ACTIVE</span>
            </div>
          </div>
          
          <button onClick={toggleMute} 
            className={clsx(
              "p-2 rounded-lg transition-all", 
              isMuted ? "bg-red-500/10 text-red-400 hover:bg-red-500/20" : "bg-zinc-800 hover:bg-zinc-700 text-white"
            )}>
            {isMuted ? <MicOff size={16} /> : <Mic size={16} />}
          </button>
        </div>
        
        {/* Peers List */}
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
           {/* ME */}
           <div className="flex flex-col items-center gap-1.5 min-w-[50px]">
             <div className="w-10 h-10 rounded-full bg-zinc-800 border-2 border-emerald-500/50 flex items-center justify-center relative overflow-hidden">
                {user.email?.[0].toUpperCase()}
                {isMuted && <div className="absolute inset-0 bg-red-500/50 flex items-center justify-center"><MicOff size={12}/></div>}
             </div>
             <span className="text-[10px] text-zinc-400 font-medium truncate max-w-[50px]">You</span>
           </div>

           {/* OTHERS (ИЗМЕНЕНИЯ ТУТ) */}
           {peers.map(peer => (
             <div key={peer.id} className="flex flex-col items-center gap-1.5 min-w-[50px]">
                <div className="w-10 h-10 rounded-full bg-indigo-900/50 border-2 border-indigo-500 flex items-center justify-center relative">
                  {/* Первая буква имени */}
                  <span className="text-xs font-bold text-indigo-200">
                    {peer.username ? peer.username[0].toUpperCase() : '?'}
                  </span>
                  <AudioPlayer stream={peer.stream} />
                </div>
                {/* Полное имя (обрезанное) */}
                <span className="text-[10px] text-zinc-400 font-medium truncate max-w-[60px]">
                    {peer.username ? peer.username.split('@')[0] : 'Connecting...'}
                </span>
             </div>
           ))}
        </div>
      </div>
    )
}

// 4. MAIN APP
export default function DiscordLite() {
  const [user, setUser] = useState<any>(null)
  const [rooms, setRooms] = useState<Room[]>([])
  const [currentRoom, setCurrentRoom] = useState<Room | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [newMessage, setNewMessage] = useState('')
  
  const supabase = createClient()
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Load Initial Data
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

    const channel = supabase.channel('room_updates')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'rooms' }, (payload) => {
        setRooms(prev => [...prev, payload.new as Room])
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [])

  // Load Messages
  useEffect(() => {
    if (!currentRoom) return

    const fetchMessages = async () => {
      const { data } = await supabase
        .from('messages')
        .select('*, profiles(username)')
        .eq('room_id', currentRoom.id)
        .order('created_at', { ascending: true })
      if (data) setMessages(data as any)
    }
    fetchMessages()

    const channel = supabase.channel(`chat:${currentRoom.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `room_id=eq.${currentRoom.id}` }, async (payload) => {
        const { data: userData } = await supabase.from('profiles').select('username').eq('id', payload.new.user_id).single()
        const newMsg = { ...payload.new, profiles: userData }
        setMessages(prev => [...prev, newMsg as any])
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [currentRoom])

  // Scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  // Send Message
  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newMessage.trim() || !user || !currentRoom) return
    await supabase.from('messages').insert({ room_id: currentRoom.id, user_id: user.id, content: newMessage })
    setNewMessage('')
  }

  const createRoom = async () => {
    const name = prompt("Enter room name:")
    if (name && user) {
      await supabase.from('rooms').insert({ name, created_by: user.id })
    }
  }

  if (!user) return <AuthScreen onLogin={() => window.location.reload()} />

  return (
    <div className="flex h-screen bg-[#09090b] text-zinc-100 overflow-hidden font-sans selection:bg-indigo-500/30">
      
      {/* SIDEBAR */}
      <aside className="w-72 bg-[#0c0c0e] flex flex-col border-r border-zinc-800/60 shadow-xl z-20">
        <div className="h-14 flex items-center px-4 border-b border-zinc-800/60 bg-[#0c0c0e]">
          <span className="font-bold text-lg tracking-tight flex items-center gap-2">
            <Radio className="text-indigo-500" size={20} />
            Nether<span className="text-indigo-500">Cord</span>
          </span>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-1">
          <div className="text-xs font-semibold text-zinc-500 uppercase px-2 mb-2 tracking-wider">Voice Channels</div>
          {rooms.map(room => (
            <button key={room.id} onClick={() => setCurrentRoom(room)}
              className={clsx(
                "w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all group", 
                currentRoom?.id === room.id 
                  ? "bg-zinc-800 text-white shadow-sm" 
                  : "text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200"
              )}>
              <Hash size={16} className={currentRoom?.id === room.id ? "text-indigo-400" : "text-zinc-600 group-hover:text-zinc-400"} />
              <span className="truncate">{room.name}</span>
            </button>
          ))}
          
          <button onClick={createRoom} className="w-full flex items-center gap-2 px-3 py-2 mt-4 text-xs font-medium text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/30 rounded-lg transition-colors border border-dashed border-zinc-800 hover:border-zinc-700">
            <Plus size={14} />
            <span>Create Channel</span>
          </button>
        </div>

        <div className="p-3 bg-[#09090b] border-t border-zinc-800/60">
           <div className="flex items-center gap-3 p-2 rounded-lg hover:bg-zinc-800/50 transition-colors">
              <div className="w-9 h-9 rounded-full bg-gradient-to-tr from-indigo-500 to-purple-500 flex items-center justify-center text-sm font-bold shadow-lg shadow-indigo-500/20 text-white shrink-0">
                 {user.email?.[0].toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-white truncate leading-tight">{user.email?.split('@')[0]}</div>
                <div className="text-xs text-zinc-500 truncate leading-tight opacity-70">Online</div>
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
            <header className="h-14 border-b border-zinc-800/60 flex items-center px-6 bg-[#09090b]/80 backdrop-blur-md sticky top-0 z-10">
              <Hash className="mr-3 text-zinc-500" size={20} />
              <span className="font-bold text-white tracking-tight">{currentRoom.name}</span>
            </header>
            
            <div className="flex-1 overflow-y-auto p-6 space-y-6 scroll-smooth">
              {messages.map((msg, i) => {
                const isMe = msg.user_id === user.id
                return (
                  <div key={msg.id} className={clsx("flex gap-4 group", isMe && "flex-row-reverse")}>
                     <div className="w-10 h-10 rounded-full bg-zinc-800 flex items-center justify-center text-zinc-400 text-sm font-bold shrink-0 mt-0.5 border border-zinc-800">
                        {msg.profiles?.username?.[0].toUpperCase() || '?'}
                     </div>
                     <div className={clsx("flex flex-col max-w-[70%]", isMe ? "items-end" : "items-start")}>
                        <div className="flex items-baseline gap-2 mb-1">
                          <span className={clsx("font-semibold text-sm", isMe ? "text-indigo-400" : "text-zinc-300")}>
                            {msg.profiles?.username || 'Unknown'}
                          </span>
                          <span className="text-[10px] text-zinc-600">
                            {new Date(msg.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                          </span>
                        </div>
                        <div className={clsx(
                          "px-4 py-2.5 rounded-2xl text-[15px] leading-relaxed break-words shadow-sm",
                          isMe 
                            ? "bg-indigo-600 text-white rounded-tr-sm" 
                            : "bg-zinc-800/70 text-zinc-200 rounded-tl-sm border border-zinc-800"
                        )}>
                          {msg.content}
                        </div>
                     </div>
                  </div>
                )
              })}
              <div ref={messagesEndRef} className="h-4" />
            </div>

            <div className="bg-[#09090b] px-4 pb-6 pt-2">
              <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl overflow-hidden shadow-2xl">
                
                {/* ВСТАВЛЯЕМ КОМПОНЕНТ ВОТ ТАК - ЭТО БЕЗОПАСНО */}
                {currentRoom && user && (
                    <VoiceControls room={currentRoom} user={user} />
                )}

                <form onSubmit={sendMessage} className="relative p-2 flex items-center gap-2">
                  <button type="button" className="p-2 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 rounded-full transition-colors">
                    <Plus size={20} />
                  </button>
                  <input 
                    className="flex-1 bg-transparent text-zinc-200 placeholder:text-zinc-600 px-2 py-3 outline-none font-medium" 
                    placeholder={`Message #${currentRoom.name}`}
                    value={newMessage}
                    onChange={e => setNewMessage(e.target.value)}
                  />
                  <button type="submit" disabled={!newMessage.trim()} 
                    className="p-2 text-indigo-500 hover:bg-indigo-500/10 rounded-lg transition-all disabled:opacity-50 disabled:hover:bg-transparent">
                    <Send size={18} />
                  </button>
                </form>
              </div>
            </div>

          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-zinc-500 space-y-4">
            <div className="w-16 h-16 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center rotate-12 shadow-2xl">
               <Hash size={32} className="text-zinc-700" />
            </div>
            <p className="font-medium">Select a channel to start talking</p>
          </div>
        )}
      </main>
    </div>
  )
}