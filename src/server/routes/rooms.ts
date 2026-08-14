import { Hono } from 'hono';
import { z } from 'zod';
import { authMiddleware, requireRole, optionalAuthMiddleware } from '../middleware/auth';
import { writeAuditLog } from '../middleware/audit';
import { HonoEnv } from '../types';

const roomsApp = new Hono<HonoEnv>();

roomsApp.get('/', optionalAuthMiddleware, async (c) => {
  const rows = await c.env.DB
    .prepare(`SELECT * FROM rooms WHERE is_active = 1 ORDER BY name ASC`)
    .all<any>();
  return c.json({ success: true, rooms: rows.results || [] });
});

const roomSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1, '請輸入會議室名稱'),
  capacity: z.number().int().min(1, '容納人數至少為 1 人').default(10),
  location: z.string().optional().nullable(),
  colorKey: z.string().default('cat-1'),
  isActive: z.boolean().optional().default(true),
});

roomsApp.post('/', authMiddleware, requireRole('superadmin', 'admin'), async (c) => {
  const user = c.get('user')!;
  const body = await c.req.json();
  const parsed = roomSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ success: false, error: parsed.error.issues[0].message }, 400);
  }

  const { name, capacity, location, colorKey, isActive } = parsed.data;
  const id = parsed.data.id || `room-${Date.now()}`;

  // A client-supplied `id` that already exists used to hit the primary key constraint and
  // come back as an opaque 500. It is a bad request, so report it as one.
  const clash = await c.env.DB.prepare(`SELECT id FROM rooms WHERE id = ?`).bind(id).first<any>();
  if (clash) {
    return c.json({ success: false, error: `會議室代碼 [${id}] 已存在` }, 400);
  }

  await c.env.DB
    .prepare(`INSERT INTO rooms (id, name, capacity, location, color_key, is_active) VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(id, name, capacity, location || null, colorKey, isActive ? 1 : 0)
    .run();

  await writeAuditLog(c.env.DB, user.id, 'CREATE_ROOM', 'room', id, null, parsed.data, c.get('clientIp'));

  return c.json({ success: true, message: '會議室建立成功', roomId: id });
});

roomsApp.patch('/:id', authMiddleware, requireRole('superadmin', 'admin'), async (c) => {
  const user = c.get('user')!;
  const id = c.req.param('id');
  const body = await c.req.json();
  const parsed = roomSchema.partial().safeParse(body);
  if (!parsed.success) {
    return c.json({ success: false, error: parsed.error.issues[0].message }, 400);
  }

  const existing = await c.env.DB.prepare(`SELECT * FROM rooms WHERE id = ?`).bind(id).first<any>();
  if (!existing) {
    return c.json({ success: false, error: '會議室不存在' }, 404);
  }

  const d = parsed.data;
  await c.env.DB
    .prepare(`UPDATE rooms SET name = ?, capacity = ?, location = ?, color_key = ?, is_active = ? WHERE id = ?`)
    .bind(
      d.name !== undefined ? d.name : existing.name,
      d.capacity !== undefined ? d.capacity : existing.capacity,
      d.location !== undefined ? d.location : existing.location,
      d.colorKey !== undefined ? d.colorKey : existing.color_key,
      d.isActive !== undefined ? (d.isActive ? 1 : 0) : existing.is_active,
      id
    )
    .run();

  await writeAuditLog(c.env.DB, user.id, 'UPDATE_ROOM', 'room', id, existing, d, c.get('clientIp'));

  return c.json({ success: true, message: '會議室更新成功' });
});

roomsApp.delete('/:id', authMiddleware, requireRole('superadmin', 'admin'), async (c) => {
  const user = c.get('user')!;
  const id = c.req.param('id');

  const existing = await c.env.DB.prepare(`SELECT * FROM rooms WHERE id = ?`).bind(id).first<any>();
  if (!existing) {
    return c.json({ success: false, error: '會議室不存在' }, 404);
  }

  await c.env.DB.prepare(`UPDATE rooms SET is_active = 0 WHERE id = ?`).bind(id).run();
  await writeAuditLog(c.env.DB, user.id, 'DELETE_ROOM', 'room', id, existing, null, c.get('clientIp'));

  return c.json({ success: true, message: '會議室已停用' });
});

export default roomsApp;
