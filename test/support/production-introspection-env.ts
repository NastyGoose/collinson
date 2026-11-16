// Side-effect import for a spec that boots AppModule as production would, with
// introspection turned back on by GRAPHQL_INTROSPECTION. Import it before
// AppModule, as production-env.ts explains.
process.env.NODE_ENV = 'production';
process.env.GRAPHQL_INTROSPECTION = 'true';
