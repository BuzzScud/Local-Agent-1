export const config = {
  appName: 'desk-monitor',
  refreshSeconds: 15,
  port: Number(process.env.MONITOR_PORT ?? 8790),
};
