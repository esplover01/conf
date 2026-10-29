import Database from "better-sqlite3";
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import bcrypt from 'bcryptjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const db = new Database(join(__dirname, 'conf.db'));
db.pragma("foreign_keys = ON");

// Создание таблиц
db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        login TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        fio TEXT NOT NULL,
        phone TEXT NOT NULL,
        email TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))    
    );

    CREATE TABLE IF NOT EXISTS rooms (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        capacity INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        room_id INTEGER NOT NULL,
        date_start TEXT NOT NULL,
        payment TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'Новая',
        review TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE RESTRICT
    );

    CREATE TABLE IF NOT EXISTS reviews (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        request_id INTEGER NOT NULL,
        rating INTEGER NOT NULL,
        text TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (request_id) REFERENCES requests(id) ON DELETE CASCADE
    );
`);
const hash = pwd => bcrypt.hashSync(pwd, 10);

if (db.prepare('SELECT COUNT(*) AS c FROM users').get().c === 0) {
    const stmt = db.prepare('INSERT INTO users (login, password, fio, phone, email) VALUES (?, ?, ?, ?, ?)');
    stmt.run('ivan', hash('demo'), 'Иванов Иван', '8(999)123-45-67', 'ivan@example.com');
    stmt.run('petr', hash('demo'), 'Петров Пётр', '8(999)123-33-33', 'petr@example.com');
    stmt.run('anna', hash('demo'), 'Сидорова Анна', '8(950)432-45-67', 'anna@example.com');
    stmt.run('Conf2027', hash('Demo77'), 'Администратор', '8(999)000-00-00', 'admin@conf.ru');
}

if (db.prepare('SELECT COUNT(*) AS c FROM rooms').get().c === 0) {
    const stmt = db.prepare('INSERT INTO rooms (name, type, capacity) VALUES (?, ?, ?)');
    stmt.run('Конференц-зал "Горизонт"', 'конференц-зал', 20);
    stmt.run('Переговорная №1', 'переговорная', 6);
    stmt.run('Опенспейс разработки', 'опенспейс', 12);
}

if (db.prepare('SELECT COUNT(*) AS c FROM requests').get().c === 0) {
    const stmt = db.prepare('INSERT INTO requests (user_id, room_id, date_start, payment) VALUES (?, ?, ?, ?)');
    stmt.run(1, 1, '2027-03-15', 'При очном посещении');
    stmt.run(1, 3, '2027-03-20', 'Перевод по СБП');    
    stmt.run(2, 2, '2027-04-10', 'При очном посещении');       
}

if (db.prepare('SELECT COUNT(*) AS c FROM reviews').get().c === 0) {
    const stmt = db.prepare('INSERT INTO reviews (request_id, rating, text) VALUES (?, ?, ?)');
    stmt.run(1, 5, 'Отличный зал, всё понравилось, проектор работал исправно.');
    stmt.run(2, 4, 'Хороший опенспейс, но было немного шумно.');
    stmt.run(2, 5, 'Уютная переговорная, идеально для встречи с клиентом.');
}

class UserModel {
    findByLogin(login) {
        return db.prepare('SELECT * FROM users WHERE login = ?').get(login);
    }
    exists(login) {
        return !!this.findByLogin(login);
    }
    create({ login, password, fio, phone, email }) {
        return db.prepare('INSERT INTO users (login, password, fio, phone, email) VALUES (?, ?, ?, ?, ?)')
            .run(login, hash(password), fio, phone, email);
    }
}

class RoomModel {
    findAll() {
        return db.prepare('SELECT * FROM rooms').all();
    }
}

class RequestModel {
    create({ userId, roomId, dateStart, payment }) {
        return db.prepare('INSERT INTO requests (user_id, room_id, date_start, payment) VALUES (?, ?, ?, ?)')
            .run(userId, roomId, dateStart, payment);
    }
    findByUser(userId) {
        return db.prepare(`
            SELECT r.*, rm.name AS room_name, rm.type AS room_type
            FROM requests r
            JOIN rooms rm ON r.room_id = rm.id
            WHERE r.user_id = ?
            ORDER BY r.id DESC
        `).all(userId);
    }
    findAllDetailed() {
        return db.prepare(`
            SELECT r.*, u.fio AS user_fio, u.login AS user_login, rm.name AS room_name, rm.type AS room_type
            FROM requests r
            JOIN users u ON r.user_id = u.id
            JOIN rooms rm ON r.room_id = rm.id
            ORDER BY r.id DESC
        `).all();
    }
    findDetailed(id) {
        return db.prepare(`
            SELECT r.*, u.fio AS user_fio, u.login AS user_login, u.email AS user_email, u.phone AS user_phone,
                   rm.name AS room_name, rm.type AS room_type, rm.capacity AS room_capacity
            FROM requests r
            JOIN users u ON u.id = r.user_id
            JOIN rooms rm ON rm.id = r.room_id
            WHERE r.id = ?
        `).get(id);
    }
    updateStatus(id, status) {
        return db.prepare('UPDATE requests SET status = ? WHERE id = ?').run(status, id);
    }
    addReview(id, userId, review) {
        if (!review?.trim()) return false;
        return db.prepare("UPDATE requests SET review = ? WHERE id = ? AND user_id = ? AND status = 'Завершено'")
            .run(review.trim(), id, userId);
    }
}

export const User = new UserModel();
export const Room = new RoomModel();
export const Request = new RequestModel();

export default db;
