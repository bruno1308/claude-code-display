import { Channel } from './channel-do';

export { Channel };

export interface Env {
  ASSETS: { fetch: (req: Request) => Promise<Response> };
  CHANNELS: DurableObjectNamespace;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === '/api/ws') {
      return new Response('WS handler lands in Task 4', { status: 501 });
    }
    return env.ASSETS.fetch(req);
  },
};
