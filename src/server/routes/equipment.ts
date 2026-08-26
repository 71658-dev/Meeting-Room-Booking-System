import { Hono } from 'hono';
import { z } from 'zod';
import { authMiddleware, requireRole, optionalAuthMiddleware } from '../middleware/auth';
import { readJsonBody, INVALID_JSON_ERROR } from '../middleware/security';
import { writeAuditLog } from '../middleware/audit';
import { HonoEnv } from '../types';

const equipApp = new Hono<HonoEnv>();

equipApp.get('/', optionalAuthMiddleware, async (c) => {
  const rows = await c.env.DB.prepare(`SELECT * FROM equipment WHERE is_active = 1 ORDER BY sort_order ASC, name ASC`).all<any>();
  return c.json({ success: true, equipment: rows.results || [] });
});

const equipSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1, '請輸入設備名稱'),
  isActive: z.boolean().optional().default(true),
  sortOrder: z.number().int().default(0),
});

equipApp.post('/', authMiddleware, requireRole('superadmin', 'admin'), async (c) => {
  const user = c.get('user')!;
  const body = await readJsonBody(c);
  if (body === undefined) {
    return c.json({ success: false, error: INVALID_JSON_ERROR }, 400);
  }
  const parsed = equipSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ success: false, error: parsed.error.issues[0].message }, 400);
  }

  const { name, isActive, sortOrder } = parsed.data;
  const id = parsed.data.id || `eq-${Date.now()}`;

  // As in rooms.ts: a duplicate client-supplied id is a 400, not a 500. `name` is UNIQUE
  // on this table too, so the insert itself is guarded as well.
  const clash = await c.env.DB.prepare(`SELECT id FROM equipment WHERE id = ?`).bind(id).first<any>();
  if (clash) {
    return c.json({ success: false, error: `設備代碼 [${id}] 已存在` }, 400);
  }

  try {
    await c.env.DB
      .prepare(`INSERT INTO equipment (id, name, is_active, sort_order) VALUES (?, ?, ?, ?)`)
      .bind(id, name, isActive ? 1 : 0, sortOrder)
      .run();
  } catch (err) {
    console.warn('Equipment insert rejected:', err);
    return c.json({ success: false, error: `設備建立失敗：名稱 [${name}] 可能已存在` }, 400);
  }

  await writeAuditLog(c.env.DB, user.id, 'CREATE_EQUIP', 'equipment', id, null, parsed.data, c.get('clientIp'));

  return c.json({ success: true, message: '設備項目建立成功', equipmentId: id });
});

equipApp.patch('/:id', authMiddleware, requireRole('superadmin', 'admin'), async (c) => {
  const user = c.get('user')!;
  const id = c.req.param('id');
  const body = await readJsonBody(c);
  if (body === undefined) {
    return c.json({ success: false, error: INVALID_JSON_ERROR }, 400);
  }
  const parsed = equipSchema.partial().safeParse(body);
  if (!parsed.success) {
    return c.json({ success: false, error: parsed.error.issues[0].message }, 400);
  }

  const existing = await c.env.DB.prepare(`SELECT * FROM equipment WHERE id = ?`).bind(id).first<any>();
  if (!existing) {
    return c.json({ success: false, error: '設備項目不存在' }, 404);
  }

  const d = parsed.data;
  await c.env.DB
    .prepare(`UPDATE equipment SET name = ?, is_active = ?, sort_order = ? WHERE id = ?`)
    .bind(
      d.name !== undefined ? d.name : existing.name,
      d.isActive !== undefined ? (d.isActive ? 1 : 0) : existing.is_active,
      d.sortOrder !== undefined ? d.sortOrder : existing.sort_order,
      id
    )
    .run();

  await writeAuditLog(c.env.DB, user.id, 'UPDATE_EQUIP', 'equipment', id, existing, d, c.get('clientIp'));

  return c.json({ success: true, message: '設備項目更新成功' });
});

equipApp.delete('/:id', authMiddleware, requireRole('superadmin', 'admin'), async (c) => {
  const user = c.get('user')!;
  const id = c.req.param('id');

  const existing = await c.env.DB.prepare(`SELECT * FROM equipment WHERE id = ?`).bind(id).first<any>();
  if (!existing) {
    return c.json({ success: false, error: '設備項目不存在' }, 404);
  }

  await c.env.DB.prepare(`UPDATE equipment SET is_active = 0 WHERE id = ?`).bind(id).run();
  await writeAuditLog(c.env.DB, user.id, 'DELETE_EQUIP', 'equipment', id, existing, null, c.get('clientIp'));

  return c.json({ success: true, message: '設備項目已停用' });
});

export default equipApp;
