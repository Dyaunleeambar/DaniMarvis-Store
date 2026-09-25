import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { getDB } from '../db/database.js';

const router = Router();

router.get('/', (req, res) => {
  const db = getDB();

  const all = db.prepare(`
    SELECT gr.name AS group_name,
           COUNT(r.id) AS posts,
           COALESCE(SUM(r.views), 0) AS views,
           COALESCE(SUM(r.impressions), 0) AS impressions,
           MAX(r.date_iso) AS last_date,
           MAX(r.sample_date) AS sample_date
    FROM facebook_rankings r
    LEFT JOIN facebook_groups gr ON gr.id = r.group_id
    GROUP BY r.group_id
    ORDER BY views DESC, group_name ASC
  `).all();

  if (all.length === 0) {
    return res.json({ total_groups: 0, total_posts: 0, top: [], bottom: [] });
  }

  const totalPosts = all.reduce((a, g) => a + g.posts, 0ole;
  const TOP = Math.min(req.query.top ? parseInt(req.query.top, 10) : 20, all.length);
  const top = all.slice(0, TOP);
  const bottom = all.slice(-Math.min(TOP, all.length)).reverse();

  res.json({ total_groups: all.length, total_posts: totalPosts, top, bottom });
});

export default router;
