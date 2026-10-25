import Database from "better-sqlite3";
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import bcrypt from 'bcryptjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const db = new Database(join(__dirname, 'conf.db'));

db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS room_types (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS payment_methods (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS request_statuses (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS users (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    login      TEXT NOT NULL UNIQUE,
    password   TEXT NOT NULL,
    fio        TEXT NOT NULL,
    phone      TEXT NOT NULL,
    email      TEXT NOT NULL,
    role       TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS rooms (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    name     TEXT NOT NULL UNIQUE,
    type_id  INTEGER NOT NULL,
    capacity INTEGER NOT NULL CHECK (capacity > 0),
    FOREIGN KEY (type_id) REFERENCES room_types(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS requests (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id           INTEGER NOT NULL,
    room_id           INTEGER NOT NULL,
    date_start        TEXT NOT NULL,
    payment_method_id INTEGER NOT NULL,
    status_id         INTEGER NOT NULL,
    created_at        TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id)           REFERENCES users(id)            ON DELETE CASCADE,
    FOREIGN KEY (room_id)           REFERENCES rooms(id)            ON DELETE RESTRICT,
    FOREIGN KEY (payment_method_id) REFERENCES payment_methods(id)  ON DELETE RESTRICT,
    FOREIGN KEY (status_id)         REFERENCES request_statuses(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS reviews (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id INTEGER NOT NULL UNIQUE,
    rating     INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
    text       TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (request_id) REFERENCES requests(id) ON DELETE CASCADE
);
`);

const isEmpty = table => db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get().c === 0;

const seed = db.transaction(() => {
  if (isEmpty('room_types')) {
    const s = db.prepare('INSERT INTO room_types (name) VALUES (?)');
    ['Конференц-зал', 'Переговорная', 'Кабинет'].forEach(n => s.run(n));
  }

  if (isEmpty('payment_methods')) {
    const s = db.prepare('INSERT INTO payment_methods (name) VALUES (?)');
    ['При очном посещении', 'Перевод по СБП'].forEach(n => s.run(n));
  }

  if (isEmpty('request_statuses')) {
    const s = db.prepare('INSERT INTO request_statuses (name) VALUES (?)');
    ['Новая', 'Подтверждена', 'Завершена', 'Отклонена'].forEach(n => s.run(n));
  }

  if (isEmpty('users')) {
    const s = db.prepare(`
      INSERT INTO users (login, password, fio, phone, email, role)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const h = p => bcrypt.hashSync(p, 10);
    s.run('Conf2027', h('Conf2027'), 'Администратор',   '8(900)090-81-27', 'admin@gmail.com',  'admin');
    s.run('alex2027', h('demo2027'), 'Алексей Майоров', '8(900)090-81-29', 'alex@gmail.com',   'user');
    s.run('anna2027', h('demo2027'), 'Сидорова Анна',   '8(950)432-45-67', 'anna@example.com', 'user');
  }

  if (isEmpty('rooms')) {
    const typeId = n => db.prepare('SELECT id FROM room_types WHERE name = ?').get(n).id;
    const s = db.prepare('INSERT INTO rooms (name, type_id, capacity) VALUES (?, ?, ?)');
    s.run('Конференц-зал "Белка"', typeId('Конференц-зал'), 20);
    s.run('Переговорная №1',       typeId('Переговорная'),  6);
    s.run('Кабинет разработки',    typeId('Кабинет'),       12);
  }

  if (isEmpty('requests')) {
    const userId   = l => db.prepare('SELECT id FROM users WHERE login = ?').get(l).id;
    const roomId   = n => db.prepare('SELECT id FROM rooms WHERE name = ?').get(n).id;
    const payId    = n => db.prepare('SELECT id FROM payment_methods WHERE name = ?').get(n).id;
    const statusId = n => db.prepare('SELECT id FROM request_statuses WHERE name = ?').get(n).id;

    const s = db.prepare(`
      INSERT INTO requests (user_id, room_id, date_start, payment_method_id, status_id)
      VALUES (?, ?, ?, ?, ?)
    `);
    s.run(userId('alex2027'), roomId('Конференц-зал "Белка"'), '2026-09-15', payId('При очном посещении'), statusId('Завершена'));
    s.run(userId('alex2027'), roomId('Кабинет разработки'),    '2026-09-20', payId('Перевод по СБП'),      statusId('Завершена'));
    s.run(userId('anna2027'), roomId('Переговорная №1'),       '2026-10-10', payId('При очном посещении'), statusId('Завершена'));
    s.run(userId('anna2027'), roomId('Конференц-зал "Белка"'), '2027-03-15', payId('Перевод по СБП'),      statusId('Подтверждена'));
    s.run(userId('alex2027'), roomId('Переговорная №1'),       '2027-04-10', payId('При очном посещении'), statusId('Новая'));
  }

  if (isEmpty('reviews')) {
    const s = db.prepare('INSERT INTO reviews (request_id, rating, text) VALUES (?, ?, ?)');
    s.run(1, 5, 'Отличный зал, всё понравилось, проектор работал исправно.');
    s.run(2, 5, 'Отличный кабинет для деловых встреч.');
    s.run(3, 4, 'Уютная переговорная, идеально для встречи с клиентом.');
  }
});
seed();

class UserModel {
  findById(id)       { return db.prepare('SELECT * FROM users WHERE id = ?').get(id); }
  findByLogin(login) { return db.prepare('SELECT * FROM users WHERE login = ?').get(login); }
  findAll()          { return db.prepare('SELECT * FROM users').all(); }
  count()            { return db.prepare('SELECT COUNT(*) AS c FROM users').get().c; }
  exists(login)      { return !!db.prepare('SELECT 1 FROM users WHERE login = ?').get(login); }

  create({ login, password, fio, phone, email }) {
    const hash = bcrypt.hashSync(password, 10);
    const r = db.prepare(`
      INSERT INTO users (login, password, fio, phone, email)
      VALUES (?, ?, ?, ?, ?)
    `).run(login, hash, fio, phone, email);
    return this.findById(r.lastInsertRowid);
  }
}

class RoomModel {
  #select = `
    SELECT r.id, r.name, r.capacity, r.type_id, t.name AS type
    FROM rooms r
    JOIN room_types t ON t.id = r.type_id
  `;
  findAll()        { return db.prepare(this.#select).all(); }
  findById(id)     { return db.prepare(`${this.#select} WHERE r.id = ?`).get(id); }
  findByType(type) { return db.prepare(`${this.#select} WHERE t.name = ?`).all(type); }
  count()          { return db.prepare('SELECT COUNT(*) AS c FROM rooms').get().c; }
  types()          { return db.prepare('SELECT * FROM room_types ORDER BY name').all(); }
}

class RequestModel {
  #select = `
    SELECT r.id, r.user_id, r.room_id, r.date_start, r.created_at,
           u.fio   AS user_fio,
           rm.name AS room_name,
           pm.name AS payment,
           st.name AS status,
           rv.rating AS review_rating,
           rv.text   AS review
    FROM requests r
    JOIN users            u  ON u.id  = r.user_id
    JOIN rooms            rm ON rm.id = r.room_id
    JOIN payment_methods  pm ON pm.id = r.payment_method_id
    JOIN request_statuses st ON st.id = r.status_id
    LEFT JOIN reviews     rv ON rv.request_id = r.id
  `;
  findById(id)       { return db.prepare(`${this.#select} WHERE r.id = ?`).get(id); }
  findByUser(userId) { return db.prepare(`${this.#select} WHERE r.user_id = ? ORDER BY r.date_start DESC`).all(userId); }
  findAllDetailed()  { return db.prepare(`${this.#select} ORDER BY r.created_at DESC`).all(); }
  count()            { return db.prepare('SELECT COUNT(*) AS c FROM requests').get().c; }

  updateStatus(id, statusName) {
    return db.prepare(`
      UPDATE requests
      SET status_id = (SELECT id FROM request_statuses WHERE name = ?)
      WHERE id = ?
    `).run(statusName, id);
  }

  create({ userId, roomId, dateStart, paymentId }) {
    const r = db.prepare(`
      INSERT INTO requests (user_id, room_id, date_start, payment_method_id, status_id)
      VALUES (?, ?, ?, ?, (SELECT id FROM request_statuses WHERE name = 'Новая'))
    `).run(userId, roomId, dateStart, paymentId);
    return this.findById(r.lastInsertRowid);
  }

  paymentMethods() { return db.prepare('SELECT * FROM payment_methods').all(); }
  statuses()       { return db.prepare('SELECT * FROM request_statuses').all(); }
}

class ReviewModel {
  findByRequest(requestId) {
    return db.prepare('SELECT * FROM reviews WHERE request_id = ?').get(requestId);
  }

  findAll() {
    return db.prepare(`
      SELECT rv.*, u.fio AS user_fio, rm.name AS room_name
      FROM reviews rv
      JOIN requests r ON r.id = rv.request_id
      JOIN users u    ON u.id = r.user_id
      JOIN rooms rm   ON rm.id = r.room_id
      ORDER BY rv.created_at DESC
    `).all();
  }

  create({ requestId, rating, text }) {
    const r = db.prepare('INSERT INTO reviews (request_id, rating, text) VALUES (?, ?, ?)')
                .run(requestId, rating, text);
    return db.prepare('SELECT * FROM reviews WHERE id = ?').get(r.lastInsertRowid);
  }
}

export const User = new UserModel();
export const Room = new RoomModel();
export const Request = new RequestModel();
export const Review = new ReviewModel();
export default db;
