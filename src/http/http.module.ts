import { Module } from '@nestjs/common';
import { HTTP_FETCH } from './http.constants';
import type { HttpFetch } from './http.types';
import { JsonRequestService } from './json-request.service';

const globalFetch: HttpFetch = (input, init) => fetch(input, init);

@Module({
  providers: [{ provide: HTTP_FETCH, useValue: globalFetch }, JsonRequestService],
  exports: [JsonRequestService],
})
export class HttpModule {}
