// Side-effect import for a spec that boots AppModule as production would. Import
// it before AppModule: ConfigModule validates the environment once, when the
// module is first imported. Jest gives each spec file its own process.env copy,
// so this does not leak into other specs.
process.env.NODE_ENV = 'production';
delete process.env.GRAPHQL_INTROSPECTION;
