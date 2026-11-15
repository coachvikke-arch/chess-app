import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useClassReminders } from '../../matezone-bot/bot/botTriggers.js';

function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export default function StudentClassBotReminders() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [classes, setClasses] = useState([]);

  useEffect(() => {
    let active = true;
    setClasses([]);
    if (user?.role !== 'student') return () => { active = false; };
    api.get('/classes/my-upcoming')
      .then(({ data }) => { if (active) setClasses(Array.isArray(data) ? data : []); })
      .catch(() => { if (active) setClasses([]); });
    return () => { active = false; };
  }, [user?.id, user?.role]);

  const reminders = useMemo(() => classes
    .filter((item) => String(item.class_date || '').slice(0, 10) === localDateKey())
    .map((item) => ({
      id: item.id,
      name: item.topic || item.title || 'Class',
      startsAt: `${String(item.class_date).slice(0, 10)}T${item.start_time}`,
      onOpen: () => {
        if (item.meeting_url && item.class_type !== 'integrated') {
          window.open(item.meeting_url, '_blank', 'noopener,noreferrer');
        } else {
          navigate(`/live-class/${item.id}`);
        }
      },
    })), [classes, navigate]);

  useClassReminders(reminders, user?.id || '');
  return null;
}
