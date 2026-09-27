-- System 01: durable artifact schema metadata.
-- This registry is metadata only; canonical state remains in the domain tables.
CREATE TABLE artifact_schema_versions (
 artifact_type TEXT NOT NULL,
 artifact_id TEXT NOT NULL,
 scope_type TEXT NOT NULL CHECK(scope_type IN ('world','campaign')),
 scope_id TEXT NOT NULL,
 schema_version INTEGER NOT NULL CHECK(schema_version > 0),
 created_at TEXT NOT NULL,
 PRIMARY KEY(artifact_type,artifact_id,scope_type,scope_id)
) STRICT;

CREATE INDEX artifact_schema_scope ON artifact_schema_versions(scope_type,scope_id,artifact_type,artifact_id);

INSERT OR IGNORE INTO artifact_schema_versions
 (artifact_type,artifact_id,scope_type,scope_id,schema_version,created_at)
SELECT 'world',id,'world',id,1,created_at FROM worlds
UNION ALL SELECT 'campaign',id,'campaign',id,1,created_at FROM campaigns
UNION ALL SELECT 'membership',m.campaign_id||':'||m.user_id,'campaign',m.campaign_id,1,m.created_at FROM memberships m
UNION ALL SELECT 'record',r.id,CASE WHEN r.world_id IS NOT NULL THEN 'world' ELSE 'campaign' END,COALESCE(r.world_id,r.campaign_id),1,r.created_at FROM records r
UNION ALL SELECT 'section',s.id,CASE WHEN r.world_id IS NOT NULL THEN 'world' ELSE 'campaign' END,COALESCE(r.world_id,r.campaign_id),1,s.created_at FROM sections s JOIN records r ON r.id=s.record_id
UNION ALL SELECT 'field',f.id,CASE WHEN r.world_id IS NOT NULL THEN 'world' ELSE 'campaign' END,COALESCE(r.world_id,r.campaign_id),1,f.created_at FROM fields f JOIN records r ON r.id=f.record_id
UNION ALL SELECT 'field_value',v.field_id,CASE WHEN r.world_id IS NOT NULL THEN 'world' ELSE 'campaign' END,COALESCE(r.world_id,r.campaign_id),1,v.updated_at FROM field_values v JOIN fields f ON f.id=v.field_id JOIN records r ON r.id=f.record_id
UNION ALL SELECT 'domain_event',e.id,CASE WHEN e.world_id IS NOT NULL THEN 'world' ELSE 'campaign' END,COALESCE(e.world_id,e.campaign_id),e.schema_version,e.created_at FROM domain_events e
UNION ALL SELECT 'audit',a.id,CASE WHEN a.world_id IS NOT NULL THEN 'world' ELSE 'campaign' END,COALESCE(a.world_id,a.campaign_id),1,a.created_at FROM audit_log a WHERE a.world_id IS NOT NULL OR a.campaign_id IS NOT NULL
UNION ALL SELECT 'timeline',t.id,'campaign',t.campaign_id,1,t.created_at FROM timelines t
UNION ALL SELECT CASE WHEN e.kind='media' THEN 'media_reference' ELSE 'game_entity' END,e.id,'campaign',t.campaign_id,1,e.created_at FROM game_entities e JOIN timelines t ON t.id=e.timeline_id
UNION ALL SELECT 'entity_link',l.entity_id||':'||l.target_id,'campaign',t.campaign_id,1,t.created_at FROM entity_links l JOIN timelines t ON t.id=l.timeline_id
UNION ALL SELECT 'world_fact',f.id,'campaign',t.campaign_id,1,f.created_at FROM world_facts f JOIN timelines t ON t.id=f.timeline_id
UNION ALL SELECT 'character_knowledge',k.observer_id||':'||k.fact_id,'campaign',t.campaign_id,1,k.learned_at FROM character_knowledge k JOIN timelines t ON t.id=k.timeline_id
UNION ALL SELECT 'character_belief',b.id,'campaign',t.campaign_id,1,b.updated_at FROM character_beliefs b JOIN timelines t ON t.id=b.timeline_id
UNION ALL SELECT 'character_memory',m.id,'campaign',t.campaign_id,1,m.created_at FROM character_memories m JOIN timelines t ON t.id=m.timeline_id
UNION ALL SELECT 'game_event',e.id,'campaign',t.campaign_id,1,e.created_at FROM game_events e JOIN timelines t ON t.id=e.timeline_id
UNION ALL SELECT 'story_turn',s.id,'campaign',t.campaign_id,1,s.created_at FROM story_turns s JOIN timelines t ON t.id=s.timeline_id
UNION ALL SELECT 'save',s.id,'campaign',t.campaign_id,1,s.created_at FROM saves s JOIN timelines t ON t.id=s.timeline_id
UNION ALL SELECT 'creator_template',c.id,'world',c.world_id,1,c.created_at FROM creator_templates c
UNION ALL SELECT 'chronicle',c.id,'campaign',t.campaign_id,1,c.created_at FROM archived_chronicle c JOIN timelines t ON t.id=c.timeline_id
UNION ALL SELECT 'ai_usage',a.id,'campaign',t.campaign_id,1,a.created_at FROM ai_usage a JOIN timelines t ON t.id=a.timeline_id
UNION ALL SELECT 'ai_intent_usage',a.id,'campaign',t.campaign_id,1,a.created_at FROM ai_intent_usage a JOIN timelines t ON t.id=a.timeline_id;

CREATE TRIGGER artifact_schema_records_insert AFTER INSERT ON records BEGIN
 INSERT OR IGNORE INTO artifact_schema_versions VALUES ('record',NEW.id,CASE WHEN NEW.world_id IS NOT NULL THEN 'world' ELSE 'campaign' END,COALESCE(NEW.world_id,NEW.campaign_id),1,NEW.created_at);
END;
CREATE TRIGGER artifact_schema_sections_insert AFTER INSERT ON sections BEGIN
 INSERT OR IGNORE INTO artifact_schema_versions SELECT 'section',NEW.id,CASE WHEN r.world_id IS NOT NULL THEN 'world' ELSE 'campaign' END,COALESCE(r.world_id,r.campaign_id),1,NEW.created_at FROM records r WHERE r.id=NEW.record_id;
END;
CREATE TRIGGER artifact_schema_fields_insert AFTER INSERT ON fields BEGIN
 INSERT OR IGNORE INTO artifact_schema_versions SELECT 'field',NEW.id,CASE WHEN r.world_id IS NOT NULL THEN 'world' ELSE 'campaign' END,COALESCE(r.world_id,r.campaign_id),1,NEW.created_at FROM records r WHERE r.id=NEW.record_id;
END;
CREATE TRIGGER artifact_schema_values_insert AFTER INSERT ON field_values BEGIN
 INSERT OR IGNORE INTO artifact_schema_versions SELECT 'field_value',NEW.field_id,CASE WHEN r.world_id IS NOT NULL THEN 'world' ELSE 'campaign' END,COALESCE(r.world_id,r.campaign_id),1,NEW.updated_at FROM fields f JOIN records r ON r.id=f.record_id WHERE f.id=NEW.field_id;
END;
CREATE TRIGGER artifact_schema_timelines_insert AFTER INSERT ON timelines BEGIN
 INSERT OR IGNORE INTO artifact_schema_versions VALUES ('timeline',NEW.id,'campaign',NEW.campaign_id,1,NEW.created_at);
END;
CREATE TRIGGER artifact_schema_entities_insert AFTER INSERT ON game_entities BEGIN
 INSERT OR IGNORE INTO artifact_schema_versions SELECT CASE WHEN NEW.kind='media' THEN 'media_reference' ELSE 'game_entity' END,NEW.id,'campaign',t.campaign_id,1,NEW.created_at FROM timelines t WHERE t.id=NEW.timeline_id;
END;
CREATE TRIGGER artifact_schema_links_insert AFTER INSERT ON entity_links BEGIN
 INSERT OR IGNORE INTO artifact_schema_versions SELECT 'entity_link',NEW.entity_id||':'||NEW.target_id,'campaign',t.campaign_id,1,t.created_at FROM timelines t WHERE t.id=NEW.timeline_id;
END;
CREATE TRIGGER artifact_schema_facts_insert AFTER INSERT ON world_facts BEGIN
 INSERT OR IGNORE INTO artifact_schema_versions SELECT 'world_fact',NEW.id,'campaign',t.campaign_id,1,NEW.created_at FROM timelines t WHERE t.id=NEW.timeline_id;
END;
CREATE TRIGGER artifact_schema_knowledge_insert AFTER INSERT ON character_knowledge BEGIN
 INSERT OR IGNORE INTO artifact_schema_versions SELECT 'character_knowledge',NEW.observer_id||':'||NEW.fact_id,'campaign',t.campaign_id,1,NEW.learned_at FROM timelines t WHERE t.id=NEW.timeline_id;
END;
CREATE TRIGGER artifact_schema_beliefs_insert AFTER INSERT ON character_beliefs BEGIN
 INSERT OR IGNORE INTO artifact_schema_versions SELECT 'character_belief',NEW.id,'campaign',t.campaign_id,1,NEW.updated_at FROM timelines t WHERE t.id=NEW.timeline_id;
END;
CREATE TRIGGER artifact_schema_memories_insert AFTER INSERT ON character_memories BEGIN
 INSERT OR IGNORE INTO artifact_schema_versions SELECT 'character_memory',NEW.id,'campaign',t.campaign_id,1,NEW.created_at FROM timelines t WHERE t.id=NEW.timeline_id;
END;
CREATE TRIGGER artifact_schema_game_events_insert AFTER INSERT ON game_events BEGIN
 INSERT OR IGNORE INTO artifact_schema_versions SELECT 'game_event',NEW.id,'campaign',t.campaign_id,1,NEW.created_at FROM timelines t WHERE t.id=NEW.timeline_id;
END;
CREATE TRIGGER artifact_schema_story_turns_insert AFTER INSERT ON story_turns BEGIN
 INSERT OR IGNORE INTO artifact_schema_versions SELECT 'story_turn',NEW.id,'campaign',t.campaign_id,1,NEW.created_at FROM timelines t WHERE t.id=NEW.timeline_id;
END;
CREATE TRIGGER artifact_schema_saves_insert AFTER INSERT ON saves BEGIN
 INSERT OR IGNORE INTO artifact_schema_versions SELECT 'save',NEW.id,'campaign',t.campaign_id,1,NEW.created_at FROM timelines t WHERE t.id=NEW.timeline_id;
END;
CREATE TRIGGER artifact_schema_templates_insert AFTER INSERT ON creator_templates BEGIN
 INSERT OR IGNORE INTO artifact_schema_versions VALUES ('creator_template',NEW.id,'world',NEW.world_id,1,NEW.created_at);
END;
CREATE TRIGGER artifact_schema_chronicle_insert AFTER INSERT ON archived_chronicle BEGIN
 INSERT OR IGNORE INTO artifact_schema_versions SELECT 'chronicle',NEW.id,'campaign',t.campaign_id,1,NEW.created_at FROM timelines t WHERE t.id=NEW.timeline_id;
END;
CREATE TRIGGER artifact_schema_domain_events_insert AFTER INSERT ON domain_events BEGIN
 INSERT OR IGNORE INTO artifact_schema_versions VALUES ('domain_event',NEW.id,CASE WHEN NEW.world_id IS NOT NULL THEN 'world' ELSE 'campaign' END,COALESCE(NEW.world_id,NEW.campaign_id),NEW.schema_version,NEW.created_at);
END;
CREATE TRIGGER artifact_schema_ai_usage_insert AFTER INSERT ON ai_usage BEGIN
 INSERT OR IGNORE INTO artifact_schema_versions SELECT 'ai_usage',NEW.id,'campaign',t.campaign_id,1,NEW.created_at FROM timelines t WHERE t.id=NEW.timeline_id;
END;
CREATE TRIGGER artifact_schema_ai_intent_insert AFTER INSERT ON ai_intent_usage BEGIN
 INSERT OR IGNORE INTO artifact_schema_versions SELECT 'ai_intent_usage',NEW.id,'campaign',t.campaign_id,1,NEW.created_at FROM timelines t WHERE t.id=NEW.timeline_id;
END;
