import axios from 'axios';
export const api = axios.create({ baseURL: '/api', withCredentials: true });
export const message = e => e.response?.data?.message || 'Something went wrong. Please try again.';
