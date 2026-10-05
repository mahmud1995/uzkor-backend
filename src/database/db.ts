import { Injectable } from "@nestjs/common";
import { EntityManager } from "@mikro-orm/postgresql";
export type Row = Record<string, any>;
@Injectable()
export class Db {
  constructor(private readonly em: EntityManager) {}
  async query(sql: string, params: any[] = []): Promise<Row[]> {
    return this.em
      .getConnection()
      .execute(sql, params, "all", this.em.getTransactionContext());
  }
  async one(sql: string, params: any[] = []): Promise<Row | undefined> {
    return (await this.query(sql, params))[0];
  }
  async tx<T>(fn: (db: Db) => Promise<T>): Promise<T> {
    return this.em.fork().transactional((em) => fn(new Db(em)));
  }
}
