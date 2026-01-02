'use client'

import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/utils/supabase/client'
import { useWebRTC } from '@/hooks/useWebRTC'
import { Mic, MicOff, Hash, LogOut, Send, Volume2 } from 'lucide-react'
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
    <div className="flex items-center justify-center h-screen bg-black text-white">
      <div className="w-full max-w-md p-8 space-y-6 bg-zinc-900 rounded-lg border border-zinc-800">
        <h1 className="text-2xl font-bold text-center">Discord-Lite</h1>
        <input className="w-full p-3 bg-zinc-950 border border-zinc-800 rounded text-white" 
          placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} />
        <input className="w-full p-3 bg-zinc-950 border border-zinc-800 rounded text-white" 
          type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} />
        <div className="flex gap-4">
          <button onClick={() => handleAuth('login')} disabled={loading}
            className="flex-1 p-3 bg-blue-600 hover:bg-blue-700 rounded font-bold">
            Login
          </button>
          <button onClick={() => handleAuth('register')} disabled={loading}
            className="flex-1 p-3 bg-zinc-700 hover:bg-zinc-600 rounded font-bold">
            Register
          </button>
        </div>
      </div>
    </div>
  )
}

// 2. MAIN APP
export default function DiscordLite() {
  const [user, setUser] = useState<any>(null)
  const [rooms, setRooms] = useState<Room[]>([])
  const [currentRoom, setCurrentRoom] = useState<Room | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [newMessage, setNewMessage] = useState('')
  
  const supabase = createClient()
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Load User & Rooms on Mount
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

    // Realtime listener for new rooms
    const channel = supabase.channel('room_updates')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'rooms' }, (payload) => {
        setRooms(prev => [...prev, payload.new as Room])
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [])

  // Load Messages when entering a room
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
        // Fetch the username for the new message
        const { data: userData } = await supabase.from('profiles').select('username').eq('id', payload.new.user_id).single()
        const newMsg = { ...payload.new, profiles: userData }
        setMessages(prev => [...prev, newMsg as any])
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [currentRoom])

  // Scroll to bottom of chat
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

  // Create Room
  const createRoom = async () => {
    const name = prompt("Enter room name:")
    if (name && user) {
      await supabase.from('rooms').insert({ name, created_by: user.id })
    }
  }

  // --- VOICE CHAT COMPONENT (Inside the main room view) ---
  const VoiceControls = () => {
    if (!currentRoom || !user) return null
    // Use our custom hook
    const { peers, localStream, isMuted, toggleMute } = useWebRTC(currentRoom.id, user)

    return (
      <div className="bg-zinc-900 border-t border-zinc-800 p-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2 text-green-500 font-bold text-sm">
            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
            Voice Connected
          </div>
          <button onClick={toggleMute} className={clsx("p-2 rounded-full", isMuted ? "bg-red-500/20 text-red-500" : "bg-zinc-800 text-white")}>
            {isMuted ? <MicOff size={20} /> : <Mic size={20} />}
          </button>
        </div>
        
        {/* Render Audio Elements for Peers (Hidden but active) */}
        {peers.map(peer => (
          <AudioPlayer key={peer.id} stream={peer.stream} />
        ))}

        <div className="flex gap-2 overflow-x-auto pb-2">
           {/* Self Indicator */}
           <div className="flex flex-col items-center gap-1 min-w-[60px]">
             <div className="w-10 h-10 rounded-full bg-zinc-700 border-2 border-green-500 flex items-center justify-center">
                <span className="text-xs">Me</span>
             </div>
           </div>
           {/* Peer Indicators */}
           {peers.map(peer => (
             <div key={peer.id} className="flex flex-col items-center gap-1 min-w-[60px]">
                <div className="w-10 h-10 rounded-full bg-zinc-700 border-2 border-green-500 flex items-center justify-center">
                  <Volume2 size={16} />
                </div>
             </div>
           ))}
        </div>
      </div>
    )
  }

  if (!user) return <AuthScreen onLogin={() => window.location.reload()} />

  return (
    <div className="flex h-screen bg-black text-zinc-100 overflow-hidden font-sans">
      {/* SIDEBAR */}
      <div className="w-64 bg-zinc-950 border-r border-zinc-800 flex flex-col">
        <div className="p-4 border-b border-zinc-800 font-bold text-xl flex justify-between items-center">
          <span>Servers</span>
          <button onClick={createRoom} className="text-zinc-400 hover:text-white text-2xl leading-none">+</button>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {rooms.map(room => (
            <button key={room.id} onClick={() => setCurrentRoom(room)}
              className={clsx("w-full flex items-center gap-2 p-2 rounded text-left transition", currentRoom?.id === room.id ? "bg-zinc-800 text-white" : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200")}>
              <Hash size={18} />
              <span className="truncate">{room.name}</span>
            </button>
          ))}
        </div>
        <div className="p-4 bg-zinc-950 border-t border-zinc-800 flex items-center justify-between">
           <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-sm font-bold">
                 {user.email?.[0].toUpperCase()}
              </div>
              <div className="text-xs truncate max-w-[100px] text-zinc-400">{user.email}</div>
           </div>
           <button onClick={() => supabase.auth.signOut().then(() => setUser(null))} className="text-zinc-500 hover:text-white">
             <LogOut size={18} />
           </button>
        </div>
      </div>

      {/* MAIN CHAT AREA */}
      <div className="flex-1 flex flex-col min-w-0 bg-zinc-900">
        {currentRoom ? (
          <>
            {/* Header */}
            <div className="h-14 border-b border-zinc-800 flex items-center px-4 font-bold">
              <Hash className="mr-2 text-zinc-500" size={20} />
              {currentRoom.name}
            </div>
            
            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {messages.map(msg => (
                <div key={msg.id} className="group">
                  <div className="flex items-baseline gap-2">
                    <span className="font-bold text-zinc-200">{msg.profiles?.username || 'Unknown'}</span>
                    <span className="text-xs text-zinc-500">{new Date(msg.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                  </div>
                  <p className="text-zinc-300 mt-1">{msg.content}</p>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            {/* Voice Controls (Bottom of Chat) */}
            <VoiceControls />

            {/* Input */}
            <form onSubmit={sendMessage} className="p-4 bg-zinc-900">
              <div className="relative">
                <input 
                  className="w-full bg-zinc-800 text-zinc-200 rounded-lg pl-4 pr-10 py-3 outline-none focus:ring-1 focus:ring-blue-500 transition" 
                  placeholder={`Message #${currentRoom.name}`}
                  value={newMessage}
                  onChange={e => setNewMessage(e.target.value)}
                />
                <button type="submit" className="absolute right-3 top-3 text-zinc-400 hover:text-white">
                  <Send size={20} />
                </button>
              </div>
            </form>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-zinc-500">
            Select a room to start chatting
          </div>
        )}
      </div>
    </div>
  )
}

// Helper component to play audio streams
const AudioPlayer = ({ stream }: { stream: MediaStream }) => {
  const ref = useRef<HTMLAudioElement>(null)
  useEffect(() => {
    if (ref.current && stream) ref.current.srcObject = stream
  }, [stream])
  return <audio ref={ref} autoPlay />
}