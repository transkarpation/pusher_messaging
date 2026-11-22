import type { ExtractTablesWithRelations } from "drizzle-orm";
import type { NodePgDatabase, NodePgQueryResultHKT } from "drizzle-orm/node-postgres";
import type { PgTransaction } from "drizzle-orm/pg-core";
import type * as schema from "../db/schema.js";

type Schema = typeof schema;
type DrizzleTx = PgTransaction<NodePgQueryResultHKT, Schema, ExtractTablesWithRelations<Schema>>;

/** What Drizzle repositories run queries on: the database, or an open transaction. */
export type DbExecutor = NodePgDatabase<Schema> | DrizzleTx;

declare const txBrand: unique symbol;
/**
 * An open transaction, opaque to services: they only pass it to repositories' `withTx`,
 * so they stay independent of Drizzle.
 */
export type TxScope = { readonly [txBrand]: true };

export interface Transactor {
  /** Runs `fn` in one transaction; it's rolled back if `fn` throws. */
  run<T>(fn: (tx: TxScope) => Promise<T>): Promise<T>;
}

export class DrizzleTransactor implements Transactor {
  constructor(private readonly db: NodePgDatabase<Schema>) {}

  run<T>(fn: (tx: TxScope) => Promise<T>): Promise<T> {
    return this.db.transaction((tx) => fn(tx as unknown as TxScope));
  }
}

/** For repositories: the Drizzle transaction behind a `TxScope`. */
export const executorOf = (tx: TxScope): DbExecutor => tx as unknown as DrizzleTx;
