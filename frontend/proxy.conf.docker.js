module.exports = {
  '/api': {
    target: 'http://backend:3000',
    secure: false,
    changeOrigin: true,
    logLevel: 'info',
    proxyTimeout: 7200000,
    timeout: 7200000,
  },
};
