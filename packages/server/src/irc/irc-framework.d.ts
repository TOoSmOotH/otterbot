declare module "irc-framework" {
  import { EventEmitter } from "events";

  interface ConnectOptions {
    host: string;
    port: number;
    nick: string;
    tls?: boolean;
    password?: string;
    username?: string;
    gecos?: string;
  }

  class Client extends EventEmitter {
    connect(options: ConnectOptions): void;
    join(channel: string): void;
    part(channel: string, message?: string): void;
    say(target: string, message: string): void;
    quit(message?: string): void;
    nick: string;
  }

  export default { Client };
  export { Client };
}
