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
      const channel = url.searchParams.get('channel');
      if (!channel) return new Response('missing channel', { status: 400 });
      const id = env.CHANNELS.idFromName(channel);
      const stub = env.CHANNELS.get(id);
      return stub.fetch(req);
    }
    return env.ASSETS.fetch(req);
  },
};
