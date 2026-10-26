import { z } from 'zod';
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v, 'Invalid date');
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional().or(z.literal(''));
const coordinate = (min, max) => z.preprocess(value => value === '' || value == null ? undefined : value, z.coerce.number().min(min).max(max).optional());
const requiredCoordinate = (min, max) => z.preprocess(value => value === '' || value == null ? undefined : value, z.coerce.number().min(min).max(max));
export const eventInput = z.object({
  title: z.string().trim().min(2).max(100), shortDescription: z.string().trim().min(2).max(1000),
  description: z.string().trim().max(1000).optional().default(''), date,
  startTime: time, endTime: time, venue: z.string().trim().min(2).max(120),
  address: z.string().trim().min(5).max(300), city: z.string().trim().min(2).max(100),
  mapsUrl: z.string().trim().max(500).optional().default('').refine(v => !v || /^https:\/\/(maps\.app\.goo\.gl|www\.google\.com\/maps|maps\.google\.com)\//i.test(v), 'Use a valid Google Maps URL'),
  latitude: coordinate(-90, 90), longitude: coordinate(-180, 180),
  imageUrl: z.string().trim().max(500).optional().default('').refine(v => !v || v.startsWith('/images/'), 'Use a local curated image path')
}).superRefine((v, ctx) => {
  if (v.startTime && v.endTime && v.endTime <= v.startTime) ctx.addIssue({ code: 'custom', path: ['endTime'], message: 'End time must be after start time' });
  if ((v.latitude == null) !== (v.longitude == null)) ctx.addIssue({ code: 'custom', path: ['latitude'], message: 'Enter both latitude and longitude coordinates' });
});
export const privateSignupInput = z.object({
  role: z.enum(['worker', 'hirer']),
  fullName: z.string().trim().min(2).max(100),
  email: z.string().trim().email().max(254).transform(value => value.toLowerCase()),
  phone: z.string().trim().min(7).max(24).regex(/^[+()\d .-]+$/),
  password: z.string().min(12).max(128),
  locationLabel: z.string().trim().min(2).max(120),
  latitude: coordinate(-90, 90),
  longitude: coordinate(-180, 180),
  skills: z.string().trim().max(500).optional().default(''),
  experience: z.string().trim().max(1000).optional().default(''),
  availability: z.string().trim().max(300).optional().default(''),
  expectedPay: z.string().trim().max(100).optional().default(''),
  contactPreference: z.enum(['phone', 'email', 'either']).optional().default('either'),
  locationConsent: z.boolean().optional().default(false),
  organizationName: z.string().trim().max(120).optional().default(''),
  organizationType: z.string().trim().max(100).optional().default('')
}).superRefine((v, ctx) => {
  if (v.role === 'worker') {
    if (v.skills.length < 2) ctx.addIssue({ code: 'custom', path: ['skills'], message: 'Add at least one type of work you can do' });
    if (v.availability.length < 2) ctx.addIssue({ code: 'custom', path: ['availability'], message: 'Add your availability' });
    if (v.latitude == null || v.longitude == null) ctx.addIssue({ code: 'custom', path: ['latitude'], message: 'Set your approximate location to appear in nearby searches' });
    if (!v.locationConsent) ctx.addIssue({ code: 'custom', path: ['locationConsent'], message: 'Consent to sharing your approximate area with hirers' });
  }
  if (v.role === 'hirer') {
    if (v.organizationName.length < 2) ctx.addIssue({ code: 'custom', path: ['organizationName'], message: 'Enter your organization or event name' });
    if (v.organizationType.length < 2) ctx.addIssue({ code: 'custom', path: ['organizationType'], message: 'Enter your organization type' });
  }
  if ((v.latitude == null) !== (v.longitude == null)) ctx.addIssue({ code: 'custom', path: ['latitude'], message: 'Enter both latitude and longitude coordinates' });
});
export const privateJobInput = z.object({
  title: z.string().trim().min(3).max(120),
  description: z.string().trim().min(10).max(2000),
  workType: z.string().trim().min(2).max(120),
  date,
  startTime: time,
  endTime: time,
  venue: z.string().trim().min(2).max(120),
  address: z.string().trim().min(5).max(300),
  city: z.string().trim().min(2).max(100),
  latitude: coordinate(-90, 90),
  longitude: coordinate(-180, 180),
  positions: z.coerce.number().int().min(1).max(500),
  payAmount: z.coerce.number().min(0).max(1000000),
  payType: z.enum(['per shift', 'per hour', 'fixed'])
}).superRefine((value, ctx) => {
  if ((value.latitude == null) !== (value.longitude == null)) ctx.addIssue({ code: 'custom', path: ['latitude'], message: 'Enter both event location coordinates' });
  if (value.startTime && value.endTime && value.endTime <= value.startTime) ctx.addIssue({ code: 'custom', path: ['endTime'], message: 'End time must be after start time' });
});
export const commissionUtrInput = z.object({
  utr: z.string().trim().min(6).max(30).regex(/^[A-Za-z0-9-]+$/, 'Enter a valid UTR number').transform(value => value.toUpperCase())
});
