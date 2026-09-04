import type { InstanceManager } from '../instance-manager.js';
import type { WhatsAppServiceApp } from '../server.js';

export function healthRoutes(app: WhatsAppServiceApp, manager: InstanceManager): void {
  app.get('/health', async () => {
    const instances = manager.list();
    const statuses = await Promise.all(instances.map((i) => i.connector.getStatus()));
    const connected = statuses.filter((s) => s.state === 'connected').length;
    return { status: 'ok', instances: { total: instances.length, connected } };
  });
}
