type RefreshTask = () => Promise<void>;

export function createRefreshQueue() {
  let active: Promise<void> | null = null;
  let pending: RefreshTask | null = null;

  function takePending() {
    const task = pending;
    pending = null;
    return task;
  }

  return (task: RefreshTask): Promise<void> => {
    if (active) {
      pending = task;
      return active;
    }

    active = Promise.resolve().then(async () => {
      let next: RefreshTask | null = task;
      while (next) {
        await next();
        next = takePending();
      }
    }).finally(() => {
      active = null;
      pending = null;
    });
    return active;
  };
}
