import { DatabaseSync } from 'node:sqlite';
import bcrypt from 'bcryptjs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const db = new DatabaseSync(join(__dirname, 'conf.db'));
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  login TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  fio TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin')),
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS rooms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  capacity INTEGER NOT NULL CHECK (capacity > 0)
);

CREATE TABLE IF NOT EXISTS requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  room_id INTEGER NOT NULL,
  date_start TEXT NOT NULL,
  payment TEXT NOT NULL CHECK (payment IN ('При очном посещении','Перевод по СБП')),
  status TEXT NOT NULL DEFAULT 'Новая' CHECK (status IN ('Новая','Одобрена','Проведена')),
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_room_date ON requests(room_id, date_start);

CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER NOT NULL UNIQUE,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  text TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (request_id) REFERENCES requests(id) ON DELETE CASCADE
);
`);

if (db.prepare('SELECT COUNT(*) AS c FROM users').get().c === 0) {
  const h = (p) => bcrypt.hashSync(p, 10);
  const st = db.prepare(`INSERT INTO users (login, password, fio, phone, email, role) VALUES (?,?,?,?,?,?)`);
  st.run('admin', h('admin'),  'Администратор',  '+7 (900) 090-81-27', 'admin@gmail.com', 'admin');
  st.run('demo1', h('demo'), 'Алексей Майоров', '+7 (900) 090-81-29', 'alex@gmail.com', 'user');
}

if (db.prepare('SELECT COUNT(*) AS c FROM rooms').get().c === 0) {
  const st = db.prepare('INSERT INTO rooms (name, type, capacity) VALUES (?,?,?)');
  st.run('Конференц-зал "Белка"', 'конференц-зал', 20);
  st.run('Переговорная №1', 'переговорная', 6);
  st.run('Кабинет разработки', 'Кабинет', 12);
}

if (db.prepare('SELECT COUNT(*) AS c FROM requests').get().c === 0) {
  const st = db.prepare(`INSERT INTO requests (user_id, room_id, date_start, payment, status) VALUES (?,?,?,?,?)`);
  st.run(2, 1, '2026-09-15', 'При очном посещении', 'Проведена');
  st.run(2, 3, '2026-09-20', 'Перевод по СБП',      'Проведена');
  st.run(2, 2, '2026-11-10', 'При очном посещении', 'Новая');
}

if (db.prepare('SELECT COUNT(*) AS c FROM reviews').get().c === 0) {
  const st = db.prepare('INSERT INTO reviews (request_id, rating, text) VALUES (?,?,?)');
  st.run(1, 5, 'Отличный зал.');
  st.run(2, 4, 'Хороший Кабинет');
}

export default db;
