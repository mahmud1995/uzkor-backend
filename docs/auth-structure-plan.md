# Auth structure plan

Separate authentication into a controller for HTTP endpoints, a service for authentication logic, and DTOs for request validation. Use the existing `auth.controller.ts`, `auth.service.ts`, and `dto/` directory as the starting point.

This document is an implementation plan. The refactor should preserve current routes, response bodies, validation, authentication rules, and database behavior. No database migration is required.

Implementation status: completed on October 5, 2026. The files and imports described below are in place. The TypeScript build, all 18 tests (including PostgreSQL and HTTP integration tests), and the seed script passed using the separate `uzkor_auth_refactor_20261005_test` database. The current-state notes below record the starting point before implementation.

## Current state

As inspected on October 5, 2026:

- `src/auth/auth.controller.ts` contains `AuthController`, registration and login logic, `LoginDto`, `RegisterDto`, `AuthGuard`, `Public`, `Admin`, and `hashPassword`.
- `src/auth/auth.service.ts` is empty, and `src/auth/dto/` contains no files.
- `src/auth/auth.ts` is no longer present on disk.
- `src/app.module.ts` imports both the controller and guard from `auth.controller.ts`.
- Catalog and commerce controllers import `Public` and `Admin` from `auth.controller.ts`.
- `scripts/seed.ts` still imports `hashPassword` from the missing `src/auth/auth` path. This import must be updated for seeding to work.

## Proposed files and responsibilities

```text
src/auth/
  auth.controller.ts
  auth.service.ts
  auth.decorators.ts
  password.ts
  guards/
    auth.guard.ts
  dto/
    login.dto.ts
    register.dto.ts
```

Guards belong in the dedicated `src/auth/guards/` folder. The guard, decorators, and password helper get their own files so other features and the seed script can use them without importing an HTTP controller.

### Controller

`auth.controller.ts` owns the `/auth` routes and Swagger endpoint documentation. Inject `AuthService` instead of `Db` and `JwtService`.

Preserve `@ApiTags("Auth")`, `@Public()`, `@Controller("auth")`, and the existing response decorators. Each handler receives its DTO and delegates to the corresponding service method:

```typescript
constructor(private readonly authService: AuthService) {}

@ApiCreatedResponse({ type: RegistrationResponse })
@Post("register")
register(@Body() dto: RegisterDto) {
  return this.authService.register(dto);
}

@ApiCreatedResponse({ type: TokenResponse })
@Post("login")
login(@Body() dto: LoginDto) {
  return this.authService.login(dto);
}
```

This is a partial example, showing the intended handlers. SQL queries, password operations, and token creation belong in the service.

### Service

`auth.service.ts` exports an `@Injectable()` `AuthService` that receives `Db` and `JwtService` through its constructor.

`register(dto: RegisterDto)` should:

1. Trim and lowercase the email, as the current registration code does.
2. Hash the password with the shared `hashPassword` helper.
3. Insert the user using the existing parameterized SQL. Preserve the database defaults that create an active customer.
4. Sign a JWT with the user's ID in `sub`.
5. Return `{ user, accessToken }`, with only `id`, `email`, and `display_name` in `user`.

`login(dto: LoginDto)` should:

1. Find an active user using the existing case-insensitive email query.
2. Verify the password with the existing scrypt and timing-safe comparison logic, including the dummy-hash fallback when no stored hash exists.
3. Throw `UnauthorizedException("Invalid credentials")` when authentication fails.
4. Return `{ accessToken }` after signing a JWT with the user's ID in `sub`.

Move the existing behavior first. Changes to hashing, email normalization, or login policy should be handled separately so this refactor remains easy to verify.

### Request DTOs

`dto/login.dto.ts` exports `LoginDto` with the existing runtime validation and Swagger decorators:

- `email`: `@IsEmail()` and `@ApiProperty()`.
- `password`: `@IsString()`, `@Length(12, 128)`, and the matching Swagger length metadata.

`dto/register.dto.ts` exports `RegisterDto extends LoginDto` and adds:

- `displayName`: `@IsString()`, `@Length(1, 100)`, and `@ApiProperty()`.

Keep these as classes and retain normal runtime imports in the controller. The application's existing global `ValidationPipe` uses their metadata to validate requests and reject unknown fields.

The response classes `TokenResponse` and `RegistrationResponse` can remain in `src/common/responses.ts`. Remove the unrelated, unused response imports from the auth controller.

### Guard and decorators

`guards/auth.guard.ts` exports the existing `AuthGuard`. Update its `Db` import to `../../database/db` because the file is one directory deeper. Keep its current dependencies and behavior:

- Allow endpoints marked `Public` without a token.
- Extract and verify a bearer token for protected endpoints.
- Re-read the active user's ID and role from PostgreSQL on each authenticated request.
- Attach the user to `req.user`.
- Reject invalid authentication with HTTP 401 and deny non-admin users access to admin endpoints with HTTP 403.

`auth.decorators.ts` exports `Public` and `Admin`. Preserve the metadata keys `"public"` and `"admin"` so the guard continues to recognize them.

Keep the guard separate from registration and login logic; it protects routes throughout the application.

### Shared password helper

`password.ts` exports the existing `hashPassword` function. Preserve the random salt, scrypt parameters, and stored `salt:hash` format so existing passwords remain compatible.

Both `AuthService` and `scripts/seed.ts` import this function directly. The seed script should not need to create an authentication service or import the controller to hash an admin password.

## Dependency wiring and imports

Continue using the existing `AppModule` for this refactor:

- Import `AuthController` from `./auth/auth.controller` and keep it in `controllers`.
- Import `AuthService` from `./auth/auth.service` and add it to `providers`.
- Import `AuthGuard` from `./auth/guards/auth.guard` and retain `{ provide: APP_GUARD, useClass: AuthGuard }`.
- Keep `Db` registered and retain the existing `JwtModule` configuration, including its one-hour token lifetime, issuer, and audience.
- Update `src/catalog/catalog.ts` and `src/commerce/controller.ts` to import `Public` and `Admin` from `../auth/auth.decorators`.
- Update `scripts/seed.ts` to import `hashPassword` from `../src/auth/password`.

A dedicated `AuthModule` can be considered later. It is not needed to separate these responsibilities, and introducing it now would also require arranging access to `Db` and JWT providers across module boundaries.

## Implementation order

1. Extract the two DTO classes into `dto/` and update imports.
2. Create `guards/` and extract `AuthGuard` into `guards/auth.guard.ts`. Extract the decorators and password helper into their proposed files.
3. Move registration and login logic into `AuthService`.
4. Change the controller to delegate to the service and remove unused imports.
5. Register `AuthService` and update the guard import in `AppModule`.
6. Update catalog, commerce, and seed imports.
7. Run the verification below before rebuilding the API container.

## Verification and acceptance criteria

Run `npm test`, which includes the TypeScript build. The build covers `src/`; it does not compile `scripts/seed.ts`, so verify that script separately.

Run the existing database and HTTP integration tests with `TEST_DATABASE_URL` pointing to a dedicated disposable PostgreSQL database whose name ends in `_test`. Without this variable, the integration suite is skipped; a passing default test run does not verify authentication against PostgreSQL.

The existing integration suite covers registration, access without a token, customer rejection on admin endpoints, suspension checks, and parts of validation and OpenAPI behavior. Add focused coverage where needed for successful login, incorrect passwords, unknown users, and registration DTO validation.

Confirm these outcomes:

- `POST /auth/register` still returns HTTP 201 with `{ user, accessToken }` and never exposes the password hash.
- `POST /auth/login` still returns HTTP 201 with `{ accessToken }` for valid credentials and HTTP 401 for invalid credentials.
- Invalid request fields still produce HTTP 400; duplicate registration still uses the existing HTTP 409 conflict handling.
- Registration cannot set an admin role through the request body.
- Protected endpoints continue to enforce active account status and current role.
- Swagger still shows both auth request schemas and their response documentation.
- `npm run seed` succeeds against the intended local or test database after the helper import is updated. It writes categories and, when configured, an initial admin.
- No source or seed imports refer to the removed `auth.ts` file, and other features no longer import shared utilities from `auth.controller.ts`.

After implementation, rebuild the running API with `docker compose up -d --build api`. In Swagger at `http://localhost:3000/docs`, register or log in, authorize with the returned token, and call `GET /me/orders` to check the complete request flow.
