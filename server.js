import express from 'express';
import session from 'express-session';
import bcrypt from 'bcryptjs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import db from './db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = 3000;

const PAYMENTS = ['При очном посещении', 'Перевод по СБП'];
const NEXT_STATUS = { 'Новая': 'Одобрена', 'Одобрена': 'Проведена' };

app.set('view engine', 'ejs');
app.set('views', join(__dirname, 'views'));
app.locals.fmtDate = (d) => String(d).split('-').reverse().join('.');

app.use(express.urlencoded({ extended: true }));
app.use(express.static(join(__dirname, 'public')));
app.use(session({
  secret: process.env.SESSION_SECRET || 'change-me-to-a-long-random-string',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 2 },
}));

const INACTIVITY_LIMIT = 20 * 60 * 1000;
app.use((req, res, next) => {
  if (req.session.user) {
    const now = Date.now();
    if (req.session.lastActivity && now - req.session.lastActivity > INACTIVITY_LIMIT)
      return req.session.destroy(() => res.redirect('/login'));
    req.session.lastActivity = now;
  }
  next();
});

app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  res.locals.errors = [];
  res.locals.form = {};
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;
  next();
});

const requireAuth = (req, res, next) =>
  req.session.user ? next() : res.redirect('/login');
const requireAdmin = (req, res, next) =>
  req.session.user?.role === 'admin' ? next() : res.status(403).send('Нет доступа');

function normalizePhone(p = '') {
  let d = String(p).replace(/\D/g, '');
  if (d.length === 11 && d[0] === '8') d = '7' + d.slice(1);
  if (d.length !== 11 || d[0] !== '7') return null;
  return `+7 (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7, 9)}-${d.slice(9)}`;
}
   const isConstraint = (e) => /constraint/i.test(String(e.message));

app.get('/', (req, res) => res.render('index', { title: 'Главная' }));
app.get('/about', (req, res) => res.render('about', { title: 'О портале Конференции.РФ' }));
app.get('/contact', (req, res) => res.render('contact', { title: 'Контакты' }));
app.get('/help', (req, res) => res.render('help', { title: 'Помощь' }));
app.get('/rooms', (req, res) => {
  const rooms = db.prepare('SELECT * FROM rooms ORDER BY name').all();
  res.render('rooms', { title: 'Список помещений', rooms });
});

app.get('/register', (req, res) => res.render('register', { title: 'Регистрация на портале' }));

app.post('/register', (req, res) => {
  const { login = '', password = '', confirm = '', fio = '', phone = '', email = '' } = req.body || {};
  const errors = [];
  if (!/^[A-Za-z0-9_]{3,20}$/.test(login)) errors.push('Логин: 3–20 символов, латиница, цифры и _');
  if (password.length < 6) errors.push('Пароль не короче 6 символов');
  if (password !== confirm) errors.push('Пароли не совпадают');
  if (fio.trim().length < 3) errors.push('Введите ФИО');
  const ph = normalizePhone(phone);
  if (!ph) errors.push('Некорректный телефон');
  if (!/^\S+@\S+\.\S+$/.test(email)) errors.push('Некорректный email');
  if (errors.length)
    return res.status(400).render('register', { title: 'Регистрация на портале', errors, form: req.body });
  try {
    db.prepare('INSERT INTO users (login, password, fio, phone, email) VALUES (?,?,?,?,?)')
      .run(login, bcrypt.hashSync(password, 10), fio.trim(), ph, email.trim().toLowerCase());
  } catch (e) {
    if (isConstraint(e))
      return res.status(400).render('register', {
        title: 'Регистрация на портале', errors: ['Логин или email уже заняты'], form: req.body });
    throw e;
  }
  req.session.flash = { type: 'success', text: 'Регистрация успешна. Войдите' };
  res.redirect('/login');
});

app.get('/login', (req, res) => res.render('login', { title: 'Вход в систему' }));

app.post('/login', (req, res) => {
  const { login = '', password = '' } = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE login = ?').get(login);
  if (!u || !bcrypt.compareSync(password, u.password))
    return res.status(401).render('login', {
      title: 'Вход в систему', errors: ['Неверный логин или пароль'], form: { login } });
  req.session.user = { id: u.id, fio: u.fio, role: u.role };
  res.redirect(u.role === 'admin' ? '/admin' : '/dashboard');
});

app.post('/logout', (req, res) => req.session.destroy(() => res.redirect('/')));

app.get('/dashboard', requireAuth, (req, res) => {
  if (req.session.user.role === 'admin') return res.redirect('/admin');
  const requests = db.prepare(`
    SELECT r.id, r.date_start, r.payment, r.status, rooms.name AS room_name, rv.id AS review_id
    FROM requests r
    JOIN rooms ON rooms.id = r.room_id
    LEFT JOIN reviews rv ON rv.request_id = r.id
    WHERE r.user_id = ?
    ORDER BY r.date_start DESC`).all(req.session.user.id);
  res.render('dashboard', { title: 'Личный кабинет', requests });
});

app.get('/requests/new', requireAuth, (req, res) => {
  const rooms = db.prepare('SELECT * FROM rooms ORDER BY name').all();
  res.render('request-new', { title: 'Новая заявка', rooms, payments: PAYMENTS });
});

app.post('/requests', requireAuth, (req, res) => {
  const { room_id = '', date_start = '', payment = '' } = req.body || {};
  const rooms = db.prepare('SELECT * FROM rooms ORDER BY name').all();
  const today = new Date().toLocaleDateString('sv-SE'); // YYYY-MM-DD, местное время
  const errors = [];
  if (!rooms.some((r) => String(r.id) === room_id)) errors.push('Выберите помещение');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date_start) || date_start < today) errors.push('Дата не может быть в прошлом');
  if (!PAYMENTS.includes(payment)) errors.push('Выберите способ оплаты');
  if (!errors.length) {
    try {
      db.prepare('INSERT INTO requests (user_id, room_id, date_start, payment) VALUES (?,?,?,?)')
        .run(req.session.user.id, room_id, date_start, payment);
      return res.redirect('/dashboard');
    } catch (e) {
      if (isConstraint(e)) errors.push('Это помещение уже занято на выбранную дату');
      else throw e;
    }
  }
  res.status(400).render('request-new', {
    title: 'Новая заявка', rooms, payments: PAYMENTS, errors, form: req.body });
});

const ownRequest = (req) => db.prepare(`
  SELECT r.*, rooms.name AS room_name FROM requests r
  JOIN rooms ON rooms.id = r.room_id
  WHERE r.id = ? AND r.user_id = ?`).get(req.params.id, req.session.user.id);

app.get('/requests/:id/review', requireAuth, (req, res) => {
  const r = ownRequest(req);
  if (!r || r.status !== 'Проведена') return res.redirect('/dashboard');
  res.render('review', { title: 'Оставить отзыв', request: r });
});

app.post('/requests/:id/review', requireAuth, (req, res) => {
  const r = ownRequest(req);
  if (!r || r.status !== 'Проведена') return res.redirect('/dashboard');
  const rating = Number(req.body?.rating);
  const text = String(req.body?.text || '').trim();
  const errors = [];
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) errors.push('Оценка должна быть от 1 до 5');
  if (!text) errors.push('Напишите комментарий');
  if (!errors.length) {
    try {
      db.prepare('INSERT INTO reviews (request_id, rating, text) VALUES (?,?,?)').run(r.id, rating, text);
      return res.redirect('/dashboard');
    } catch (e) {
      if (isConstraint(e)) errors.push('Отзыв уже оставлен');
      else throw e;
    }
  }
  res.status(400).render('review', { title: 'Оставить отзыв', request: r, errors, form: req.body });
});

app.get('/admin', requireAuth, requireAdmin, (req, res) => {
  const requests = db.prepare(`
    SELECT r.id, r.date_start, r.payment, r.status, u.fio, u.phone,
           rooms.name AS room_name, rv.rating, rv.text AS review_text
    FROM requests r
    JOIN users u ON u.id = r.user_id
    JOIN rooms ON rooms.id = r.room_id
    LEFT JOIN reviews rv ON rv.request_id = r.id
    ORDER BY r.created_at DESC, r.id DESC`).all();
  res.render('admin', { title: 'Админ-панель', requests, nextStatus: NEXT_STATUS });
});

app.post('/admin/requests/:id/status', requireAuth, requireAdmin, (req, res) => {
  const r = db.prepare('SELECT status FROM requests WHERE id = ?').get(req.params.id);
  if (r && NEXT_STATUS[r.status] === req.body?.status)
    db.prepare('UPDATE requests SET status = ? WHERE id = ?').run(req.body.status, req.params.id);
  res.redirect('/admin');
});

app.use((req, res) => res.status(404).render('error', { title: 'Страница не найдена', code: 404, message: 'Такой страницы нет.' }));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('error', { title: 'Ошибка', code: 500, message: 'Ошибка сервера.' });
});

app.listen(PORT, () => console.log(`Сервер: http://localhost:${PORT}`));
