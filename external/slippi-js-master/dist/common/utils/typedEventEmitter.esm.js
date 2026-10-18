class TypedEventEmitter {
    listeners = new Map();
    on(type, listener) {
        let listeners = this.listeners.get(type);
        if (!listeners) {
            listeners = new Set();
            this.listeners.set(type, listeners);
        }
        listeners.add(listener);
        return () => this.off(type, listener);
    }
    once(type, listener) {
        const wrappedListener = (data) => {
            this.off(type, wrappedListener);
            listener(data);
        };
        return this.on(type, wrappedListener);
    }
    off(type, listener) {
        this.listeners.get(type)?.delete(listener);
    }
    removeListener(type, listener) {
        this.off(type, listener);
    }
    emit(type, data) {
        this.listeners.get(type)?.forEach((fn) => fn(data));
    }
}

export { TypedEventEmitter };
//# sourceMappingURL=typedEventEmitter.esm.js.map
