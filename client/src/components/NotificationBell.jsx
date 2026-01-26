import { useState, useEffect, useRef } from 'react';
import { Bell, Check, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';

export default function NotificationBell({ userId }) {
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!userId) return;

    fetchNotifications();

    // Subscribe to realtime changes
    const channel = supabase
      .channel('public:notifications')
      .on('postgres_changes', { 
        event: 'INSERT', 
        schema: 'public', 
        table: 'notifications',
        filter: `user_id=eq.${userId}` 
      }, (payload) => {
        setNotifications(prev => [payload.new, ...prev]);
        setUnreadCount(prev => prev + 1);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId]);

  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [dropdownRef]);

  const fetchNotifications = async () => {
    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(5);

    if (!error && data) {
      setNotifications(data);
      // Ideally count unread only, simplified here or fetch count separately
      const { count } = await supabase
        .from('notifications')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('read', false);
      setUnreadCount(count || 0);
    }
  };

  const markAsRead = async (id) => {
    const { error } = await supabase
      .from('notifications')
      .update({ read: true })
      .eq('id', id);
    
    if (!error) {
      setNotifications(notifications.map(n => n.id === id ? { ...n, read: true } : n));
      setUnreadCount(prev => Math.max(0, prev - 1));
    }
  };

  const deleteNotification = async (id, e) => {
    e.stopPropagation();
    const { error } = await supabase
      .from('notifications')
      .delete()
      .eq('id', id);
    
    if (!error) {
       setNotifications(notifications.filter(n => n.id !== id));
    }
  }

  const handleReadAll = async () => {
      await supabase
      .from('notifications')
      .update({ read: true })
      .eq('user_id', userId)
      .eq('read', false);
      
      setUnreadCount(0);
      setNotifications(notifications.map(n => ({ ...n, read: true })));
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 text-gray-400 hover:text-white transition-colors"
      >
        <Bell size={24} />
        {unreadCount > 0 && (
          <span className="absolute top-0 right-0 inline-flex items-center justify-center px-2 py-1 text-xs font-bold leading-none text-white transform translate-x-1/4 -translate-y-1/4 bg-red-600 rounded-full">
            {unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-80 bg-gray-800 rounded-lg shadow-xl overflow-hidden z-50 border border-gray-700">
          <div className="p-3 border-b border-gray-700 flex justify-between items-center">
            <h3 className="text-sm font-semibold text-white">Notifications</h3>
            {unreadCount > 0 && (
                <button onClick={handleReadAll} className="text-xs text-blue-400 hover:text-blue-300">
                    Mark all read
                </button>
            )}
          </div>
          
          <div className="max-h-96 overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="p-4 text-center text-gray-500 text-sm">
                No notifications
              </div>
            ) : (
              notifications.map(notif => (
                <div 
                  key={notif.id} 
                  className={`p-3 border-b border-gray-700 hover:bg-gray-750 transition-colors ${!notif.read ? 'bg-gray-800/50 border-l-2 border-l-blue-500' : ''}`}
                >
                  <div className="flex justify-between items-start">
                    <div className="flex-1 mr-2">
                        <p className="text-sm text-gray-300">
                            {notif.type === 'price_drop' && <span className="text-green-400 font-bold">Price Drop! </span>}
                            Price went from €{notif.old_price} to <span className="text-white font-bold">€{notif.new_price}</span>
                        </p>
                        <span className="text-xs text-gray-500 mt-1 block">
                            {new Date(notif.created_at).toLocaleDateString()}
                        </span>
                    </div>
                    <div className="flex space-x-1">
                        {!notif.read && (
                            <button 
                                onClick={() => markAsRead(notif.id)}
                                className="p-1 hover:bg-gray-700 rounded text-blue-400"
                                title="Mark as read"
                            >
                                <Check size={14} />
                            </button>
                        )}
                         <button 
                            onClick={(e) => deleteNotification(notif.id, e)}
                            className="p-1 hover:bg-gray-700 rounded text-red-400"
                            title="Delete"
                        >
                            <X size={14} />
                        </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
          
          <div className="p-2 border-t border-gray-700 text-center">
            <button 
                onClick={() => { setIsOpen(false); navigate('/notifications'); }}
                className="text-sm text-blue-400 hover:text-blue-300 block w-full py-1"
            >
              View All
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
