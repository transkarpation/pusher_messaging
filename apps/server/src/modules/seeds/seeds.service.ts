import type { SeedAccount } from "@pm/shared";
import { verifyPassword } from "../auth/index.js";
import type { RoomsService } from "../chat/index.js";
import type { UsersService } from "../users/index.js";
import { DEMO_PASSWORD, DEMO_USERNAMES, DEMO_USERS } from "./demo.js";

/** The demo accounts from `pnpm db:seed`, for the public /seeds page. */
export class SeedsService {
  constructor(
    private readonly users: UsersService,
    private readonly rooms: RoomsService,
    /** Off in production: the list hands out working credentials. */
    readonly enabled: boolean,
  ) {}

  /** Demo accounts that exist and still have the demo password, in the seed's order. */
  async accounts(): Promise<SeedAccount[]> {
    const found = await this.users.findManyCredentials(DEMO_USERNAMES);

    // Someone may have registered "olena" by hand. The seed gives all accounts the same
    // hash, so this is usually a single (slow, scrypt) check.
    const checked = new Map<string, Promise<boolean>>();
    const isDemo = (hash: string) => {
      if (!checked.has(hash)) checked.set(hash, verifyPassword(DEMO_PASSWORD, hash));
      return checked.get(hash)!;
    };
    const demo = (await Promise.all(found.map(async (c) => ((await isDemo(c.passwordHash)) ? c.user : null)))).filter(
      (u) => u !== null,
    );
    const roomNames = await this.rooms.roomNamesByUser(demo.map((u) => u.id));

    return DEMO_USERS.flatMap((spec) => {
      const user = demo.find((u) => u.username === spec.username);
      if (!user) return [];
      return [
        {
          id: user.id,
          username: user.username,
          name: user.name,
          password: DEMO_PASSWORD,
          rooms: roomNames.get(user.id) ?? [],
          note: spec.note,
        },
      ];
    });
  }
}
