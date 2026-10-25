import express from 'express';
import session from 'express-session';
import bcrypt from 'bcryptjs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { User, Room, Request } from './db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = 3000;

app.use(express.urlencoded({ extended: true }));
app.use(express.static(join(__dirname, 'public')));

app.set('view engine', 'ejs');
app.set('views', join(__dirname, 'views'));

app.use(session({
  secret: 'conf2027-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 1000 * 60 * 60 * 2,
    httpOnly: true,
    sameSite: 'lax'
  }
}));

app.use((req, res, next) => {
  res.locals.session = req.session;
  next();
});

const INACTIVITY_LIMIT = 20 * 60 * 1000;
app.use((req, res, next) => {
  if (req.session && req.session.userId) {
    const now = Date.now();
    if (req.session.lastActivity && now - req.session.lastActivity > INACTIVITY_LIMIT) {
      return req.session.destroy(() => res.redirect('/login'));
    }
    req.session.lastActivity = now;
  }
  next();
});

const requireAuth = (req, res, next) =>
  req.session.userId ? next() : res.redirect('/login');

const requireAdmin = (req, res, next) =>
  req.session.role === 'admin' ? next() : res.redirect('/login');

const RULES = [
  { field: 'login',    test: v => /^[A-Za-z0-9]{6,}$/.test(v),             msg: 'Логин: латиница+цифры, минимум 6 символов' },
  { field: 'password', test: v => v && v.length >= 8,                      msg: 'Пароль: минимум 8 символов' },
  { field: 'fio',      test: v => /^[А-Яа-яЁё\s]+$/.test(v),               msg: 'ФИО: только кириллица и пробелы' },
  { field: 'phone',    test: v => /^8\(\d{3}\)\d{3}-\d{2}-\d{2}$/.test(v), msg: 'Телефон: формат 8(ХХХ)ХХХ-ХХ-ХХ' },
  { field: 'email',    test: v => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v),    msg: 'Email: некорректный формат' }
];

const validate = data => RULES
  .filter(({ field, test }) => !test((data[field] || '').trim()))
  .map(r => r.msg);

app.get('/', (req, res) => res.redirect('/rooms'));

app.get('/about', (req, res) => {
  res.render('about', {
    title: 'О нас',
    errors: [],
    description: 'Конференция-РФ — портал бронирования конференц-залов, переговорных и кабинетов.'
  });
});

app.get('/register', (req, res) => {
  res.render('auth', { mode: 'register', form: {}, errors: [], flash: null });
});

app.post('/register', (req, res) => {
  const errors = validate(req.body);
  if (User.exists((req.body.login || '').trim())) {
    errors.push('Логин уже занят');
  }
  if (errors.length) {
    return res.render('auth', { mode: 'register', form: req.body, errors, flash: null });
  }
  User.create({
    login: req.body.login.trim(),
    password: req.body.password,
    fio: req.body.fio.trim(),
    phone: req.body.phone.trim(),
    email: req.body.email.trim()
  });
  req.session.flash = { type: 'success', text: 'Регистрация успешна. Войдите' };
  res.redirect('/login');
});

app.get('/login', (req, res) => {
  const flash = req.session.flash || null;
  delete req.session.flash;
  res.render('auth', { mode: 'login', error: null, flash });
});

app.post('/login', (req, res) => {
  const user = User.findByLogin((req.body.login || '').trim());

  if (user && bcrypt.compareSync(req.body.password || '', user.password)) {
    req.session.userId = user.id;
    req.session.fio = user.fio;
    req.session.login = user.login;
    req.session.role = user.role;
    req.session.lastActivity = Date.now();
    return res.redirect(user.role === 'admin' ? '/admin' : '/dashboard');
  }

  res.render('auth', { mode: 'login', error: 'Неверный логин или пароль', flash: null });
});

app.all('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

app.get('/dashboard', requireAuth, (req, res) => {
  res.render('dashboard', {
    title: 'Личный кабинет',
    errors: [],
    requests: Request.findByUser(req.session.userId)
  });
});

app.get('/admin', requireAdmin, (req, res) => {
  res.render('dashboard', {
    title: 'Панель администратора',
    errors: [],
    requests: Request.findAllDetailed()
  });
});

app.get('/create', requireAuth, (req, res) => {
  res.render('create_request', {
    title: 'Создание заявки',
    rooms: Room.findAll(),
    payments: Request.paymentMethods(),
    errors: []
  });
});

app.post('/create', requireAuth, (req, res) => {
  const { room_id, date_start, payment_id } = req.body;
  const errors = [];

  if (!Room.findById(Number(room_id))) errors.push('Выберите помещение');
  if (!date_start) errors.push('Укажите дату');
  if (!payment_id) errors.push('Выберите способ оплаты');

  if (errors.length) {
    return res.render('create_request', {
      title: 'Создание заявки',
      rooms: Room.findAll(),
      payments: Request.paymentMethods(),
      errors
    });
  }

  Request.create({
    userId: req.session.userId,
    roomId: Number(room_id),
    dateStart: date_start,
    paymentId: Number(payment_id)
  });
  res.redirect('/dashboard');
});

app.get('/rooms', (req, res) => {
  res.render('rooms', { title: 'Помещения', rooms: Room.findAll() });
});

app.get('/rooms/type/:type', (req, res) => {
  res.render('rooms', { title: 'Помещения', rooms: Room.findByType(req.params.type) });
});

app.listen(PORT, () => {
  console.log(`Сервер: http://localhost:${PORT}`);
});
