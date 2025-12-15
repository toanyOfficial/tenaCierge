class WebPushError extends Error {
  constructor(message, statusCode = 500, body, headers) {
    super(message);
    this.name = 'WebPushError';
    this.statusCode = statusCode;
    this.body = body;
    this.headers = headers;
  }
}

let vapidDetails = { subject: '', publicKey: '', privateKey: '' };

function setVapidDetails(subject, publicKey, privateKey) {
  vapidDetails = { subject, publicKey, privateKey };
}

function sendNotification(subscription, payload = '', options = {}) {
  const message =
    'web-push stub in use. Install the real "web-push" package to deliver notifications.';
  const error = new WebPushError(message, 501, undefined, {
    'x-web-push-stub': 'true'
  });
  // Keep async API contract
  return Promise.reject(error);
}

export { WebPushError, setVapidDetails, sendNotification };
export default { WebPushError, setVapidDetails, sendNotification };
