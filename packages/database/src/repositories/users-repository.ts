import type { AuthDatabase, CreateUserInput } from "./types.js";

export function createUsersRepository(database: AuthDatabase) {
  return {
    findByEmail(email: string) {
      return database.user.findUnique({ where: { email } });
    },

    findById(id: string) {
      return database.user.findUnique({ where: { id } });
    },

    create(input: CreateUserInput) {
      return database.user.create({ data: input });
    }
  };
}

export type UsersRepository = ReturnType<typeof createUsersRepository>;
