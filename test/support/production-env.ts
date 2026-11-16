// Side-effect import for a spec that boots AppModule as production would. Import
// it before AppModule: ConfigModule validates the environment once, when the
// module is first imported. Jest gives each spec file its own process.env copy,
// so this does not leak into other specs.
process.env.NODE_ENV = 'production';
// Empty counts as unset, so the production default applies. Deleting the key
// instead would let ConfigModule fill it from a developer's .env.
process.env.GRAPHQL_INTROSPECTION = '';
