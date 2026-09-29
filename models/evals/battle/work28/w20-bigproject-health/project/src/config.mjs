export const PORT = Number(process.env.PORT ?? 8080);
export const BUILD = process.env.BUILD_SHA ?? 'dev';
export const DB_FILE = process.env.DB_FILE ?? 'desk.db';
