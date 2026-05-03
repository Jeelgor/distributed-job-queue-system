# AI Development Rules for Job Queue System

You are acting as a senior backend engineer working on a production-grade system.

## 1. Architecture Rules

* Follow modular architecture:

  * controller → handles HTTP layer only
  * service → contains business logic
  * schema → validation (Zod)
  * route → route registration only

* NEVER mix responsibilities

* Controllers must remain thin

* No business logic inside routes or controllers

---

## 2. Tech Stack Constraints

* Language: TypeScript only
* Framework: Fastify (NOT Express)
* Database: PostgreSQL with Prisma
* Validation: Zod

---

## 3. Code Quality Rules

* Use async/await (no callbacks)
* Use proper error handling (try/catch or Fastify error flow)
* Avoid hardcoded values
* Write clean, readable, maintainable code
* Use meaningful variable and function names

---

## 4. Folder Structure (STRICT)

src/
modules/
job/
job.controller.ts
job.service.ts
job.route.ts
job.schema.ts

config/
utils/
workers/

DO NOT create random folders or change structure.

---

## 5. Database Rules

* Use Prisma Client from a centralized file
* Do not instantiate Prisma multiple times
* Follow existing schema strictly

---

## 6. API Rules

* Validate all incoming requests using Zod
* Return structured JSON responses
* Do not expose internal errors directly

---

## 7. Scalability Mindset

* Assume system will scale
* Avoid tight coupling
* Keep logic reusable

---

## 8. What NOT to do

* ❌ No monolithic files
* ❌ No mixing controller + service
* ❌ No skipping validation
* ❌ No console.log debugging (use logger)

---

## 9. Output Expectations

When generating code:

* Follow existing patterns
* Keep code minimal but production-ready
* Do not over-engineer
* Do not add unnecessary features

---

## 10. If unclear

* Ask for clarification instead of guessing
