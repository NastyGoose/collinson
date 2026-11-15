import { Module } from '@nestjs/common';
import { HTTP_FETCH } from './http.constants';
import type { HttpFetch } from './http.types';

const globalFetch: HttpFetch = (input, init) => fetch(input, init);

@Module({
  providers: [{ provide: HTTP_FETCH, useValue: globalFetch }],
  exports: [HTTP_FETCH],
})
export class HttpModule {}
