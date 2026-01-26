import { useState, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';
import { Trash2, Check, ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';
// Using the AuthContext to get userId would be better, but assuming we can pass it or fetch similarly
import { useAuth } from '../context/AuthContext';


const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseAnonKey);

export default function Notifications() {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all'); // 'all', 'unread'

  useEffect(() => {
    if (user) {
      fetchNotifications();
    }
  }, [user, filter]);

  const fetchNotifications = async () => {
    setLoading(true);
    let query = supabase
      .from('notifications')
      .select('*, products(name, image, url)')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (filter === 'unread') {
      query = query.eq('read', false);
    }

    const { data, error } = await query;

    if (!error) {
      setNotifications(data);
    }
    setLoading(false);
  };

  const markAsRead = async (id) => {
    await supabase.from('notifications').update({ read: true }).eq('id', id);
    setNotifications(notifications.map(n => n.id === id ? { ...n, read: true } : n));
  };

  const deleteNotification = async (id) => {
    await supabase.from('notifications').delete().eq('id', id);
    setNotifications(notifications.filter(n => n.id !== id));
  };

  const markAllRead = async () => {
    await supabase
      .from('notifications')
      .update({ read: true })
      .eq('user_id', user.id)
      .eq('read', false);
    
    setNotifications(notifications.map(n => ({ ...n, read: true })));
  };

  const deleteAllRead = async () => {
    // Delete all read notifications
    await supabase
        .from('notifications')
        .delete()
        .eq('user_id', user.id)
        .eq('read', true);
        
    fetchNotifications();
  }

  if (!user) return <div className="p-8 text-center text-white">Please log in.</div>;

  return (
    <div className="min-h-screen bg-gray-900 text-white p-4 md:p-8">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center mb-6">
            <Link to="/" className="mr-4 p-2 hover:bg-gray-800 rounded-full transition-colors text-gray-400 hover:text-white">
                <ArrowLeft size={24} />
            </Link>
            <h1 className="text-3xl font-bold">Notifications</h1>
        </div>

        <div className="flex flex-col md:flex-row justify-between items-center mb-6 gap-4 bg-gray-800/50 p-4 rounded-xl border border-white/5">
            <div className="flex space-x-2">
                <button 
                    onClick={() => setFilter('all')}
                    className={`px-4 py-2 rounded-lg transition-colors ${filter === 'all' ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
                >
                    All
                </button>
                <button 
                    onClick={() => setFilter('unread')}
                    className={`px-4 py-2 rounded-lg transition-colors ${filter === 'unread' ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
                >
                    Unread
                </button>
            </div>
            
            <div className="flex space-x-2">
                <button 
                    onClick={markAllRead}
                    className="flex items-center space-x-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm transition-colors text-blue-300"
                >
                    <Check size={16} />
                    <span>Mark all read</span>
                </button>
                <button 
                     onClick={deleteAllRead}
                     className="flex items-center space-x-2 px-4 py-2 bg-gray-700 hover:bg-red-900/50 rounded-lg text-sm transition-colors text-red-400"
                >
                    <Trash2 size={16} />
                    <span>Clear read</span>
                </button>
            </div>
        </div>

        {loading ? (
            <div className="text-center py-20 text-gray-500">Loading notifications...</div>
        ) : notifications.length === 0 ? (
             <div className="text-center py-20 bg-gray-800/30 rounded-xl border border-white/5">
                <p className="text-xl text-gray-400">No notifications found</p>
            </div>
        ) : (
            <div className="space-y-3">
                {notifications.map(notif => (
                    <div 
                        key={notif.id} 
                        className={`group relative p-4 rounded-xl border transition-all duration-200 ${notif.read ? 'bg-gray-800/20 border-white/5 text-gray-400' : 'bg-gray-800/80 border-blue-500/30 shadow-lg shadow-blue-500/10'}`}
                    >
                        <div className="flex justify-between items-start gap-4">
                             {/* Product Image if available (from join) */}
                             {notif.products && notif.products.image && (
                                <div className="w-16 h-16 flex-shrink-0 bg-white rounded-lg p-1 overflow-hidden">
                                     <img src={notif.products.image} alt={notif.products.name} className="w-full h-full object-contain" />
                                </div>
                             )}

                             <div className="flex-grow">
                                <Link to={notif.products ? `/product/${notif.product_id}` : '#'} className="hover:underline">
                                    <h3 className={`font-semibold text-lg ${!notif.read ? 'text-white' : ''}`}>
                                        {notif.products ? notif.products.name : 'Unknown Product'}
                                    </h3>
                                </Link>
                                <p className="mt-1">
                                    <span className="text-green-400 font-bold">Price Drop! </span>
                                    {notif.old_price && notif.new_price && (
                                        <>
                                            From <span className="line-through">€{notif.old_price}</span> to <span className="text-white font-bold text-lg">€{notif.new_price}</span>
                                        </>
                                    )}
                                </p>
                                <p className="text-xs text-gray-500 mt-2">
                                    {new Date(notif.created_at).toLocaleString()}
                                </p>
                             </div>

                             <div className="flex flex-col space-y-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                {!notif.read && (
                                    <button 
                                        onClick={() => markAsRead(notif.id)}
                                        className="p-2 bg-gray-700 hover:bg-blue-600 rounded-lg text-white transition-colors"
                                        title="Mark as read"
                                    >
                                        <Check size={16} />
                                    </button>
                                )}
                                <button 
                                    onClick={() => deleteNotification(notif.id)}
                                    className="p-2 bg-gray-700 hover:bg-red-600 rounded-lg text-white transition-colors"
                                    title="Delete"
                                >
                                    <Trash2 size={16} />
                                </button>
                             </div>
                        </div>
                    </div>
                ))}
            </div>
        )}
      </div>
    </div>
  );
}
