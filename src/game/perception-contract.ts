import {z} from 'zod';
export const perceptionSchema=z.strictObject({
 vision:z.number().min(0).max(100).default(100),hearing:z.number().min(0).max(100).default(100),
 attention:z.enum(['listening','partial','distracted','unaware','feigning']).default('listening'),
 position:z.number().min(0).max(10000).default(0),partition:z.string().max(100).default(''),
 subjective:z.array(z.strictObject({id:z.string().min(1).max(100),kind:z.enum(['dream','hallucination','distortion']),text:z.string().min(1).max(2000),cause:z.string().min(1).max(500),severity:z.number().min(1).max(100),from:z.iso.datetime(),until:z.iso.datetime()})).max(20).default([])
});
