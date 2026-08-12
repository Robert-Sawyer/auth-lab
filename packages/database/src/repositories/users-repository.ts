import type { AuthDatabase, CreateUserInput } from "./types.js";

export class UsersRepository {
  public constructor(private readonly database: AuthDatabase) {}

  public findByEmail(email: string) {
    return this.database.user.findUnique({ where: { email } });
  }

  public findById(id: string) {
    return this.database.user.findUnique({ where: { id } });
  }

  public create(input: CreateUserInput) {
    return this.database.user.create({ data: input });
  }
}
