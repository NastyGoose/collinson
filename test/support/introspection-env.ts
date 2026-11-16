// Jest setup file for the database tiers, which boot the whole AppModule. The
// contract tests rely on GraphQL introspection, so it is turned on explicitly here
// rather than inherited from a developer's .env or shell (ARC-59). A spec that
// needs another value sets it before importing AppModule, which reads the
// environment once, at import time.
process.env.GRAPHQL_INTROSPECTION = 'true';
