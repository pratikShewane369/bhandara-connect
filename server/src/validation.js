import { z } from 'zod';
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v, 'Invalid date');
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional().or(z.literal(''));
export const eventInput = z.object({
  title: z.string().trim().min(2).max(100), shortDescription: z.string().trim().min(2).max(1000),
  description: z.string().trim().max(1000).optional().default(''), date,
  startTime: time, endTime: time, venue: z.string().trim().min(2).max(120),
  address: z.string().trim().min(5).max(300), city: z.string().trim().min(2).max(100),
  mapsUrl: z.string().trim().max(500).optional().default('').refine(v => !v || /^https:\/\/(maps\.app\.goo\.gl|www\.google\.com\/maps|maps\.google\.com)\//i.test(v), 'Use a valid Google Maps URL'),
  imageUrl: z.string().trim().max(500).optional().default('').refine(v => !v || v.startsWith('/images/'), 'Use a local curated image path')
}).superRefine((v, ctx) => { if (v.startTime && v.endTime && v.endTime <= v.startTime) ctx.addIssue({ code: 'custom', path: ['endTime'], message: 'End time must be after start time' }); });
