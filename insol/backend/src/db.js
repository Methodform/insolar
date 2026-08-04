// SQLite-хранилище: пользователи и их проекты. Для старта — один файл; легко перевести на Postgres.
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const DB_PATH = process.env.DB_PATH || './data/sunplan.db';
mkdirSync(dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.exec(`
  create table if not exists users (
    id integer primary key autoincrement,
    yandex_id text unique,
    email text,
    name text,
    plan text not null default 'free',
    created_at text default (datetime('now'))
  );
  create table if not exists projects (
    id integer primary key autoincrement,
    user_id integer not null references users(id) on delete cascade,
    name text not null,
    data_json text not null,
    updated_at text default (datetime('now'))
  );
  create index if not exists idx_projects_user on projects(user_id, updated_at desc);
  create table if not exists feedback (
    id integer primary key autoincrement,
    user_id integer,
    type text,
    message text not null,
    contact text,
    url text,
    user_agent text,
    meta_json text,
    screenshot text,
    created_at text default (datetime('now'))
  );
`);

export default db;
