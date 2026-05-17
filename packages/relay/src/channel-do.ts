export class Channel {
  constructor(private state: DurableObjectState, private env: unknown) {}

  async fetch(req: Request): Promise<Response> {
    return new Response('Channel DO lands in Task 4', { status: 501 });
  }
}
