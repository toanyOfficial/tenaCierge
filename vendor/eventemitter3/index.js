class EventEmitter {
  constructor() {
    this.events = new Map();
  }

  on(event, listener) {
    const listeners = this.events.get(event) || [];
    listeners.push(listener);
    this.events.set(event, listeners);
    return this;
  }

  off(event, listener) {
    const listeners = this.events.get(event);
    if (!listeners) return this;
    this.events.set(event, listeners.filter((l) => l !== listener));
    return this;
  }

  removeListener(event, listener) {
    return this.off(event, listener);
  }

  emit(event, ...args) {
    const listeners = this.events.get(event) || [];
    listeners.forEach((listener) => listener(...args));
    return listeners.length > 0;
  }
}

module.exports = EventEmitter;
module.exports.EventEmitter = EventEmitter;
module.exports.default = EventEmitter;
