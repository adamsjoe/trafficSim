import type { RoadTypesMap } from './types';

export const DEFAULT_ROAD_TYPES: RoadTypesMap = {
  motorway:      { label: 'Motorway',      color: '#e05555', weight: 3.5, speed: 2.8,  enabled: true  },
  trunk:         { label: 'Trunk',          color: '#e07840', weight: 3.0, speed: 2.2,  enabled: true  },
  primary:       { label: 'Primary',        color: '#e0c040', weight: 2.5, speed: 1.6,  enabled: true  },
  secondary:     { label: 'Secondary',      color: '#80cc40', weight: 2.0, speed: 1.2,  enabled: true  },
  tertiary:      { label: 'Tertiary',       color: '#40c8a0', weight: 1.8, speed: 1.0,  enabled: true  },
  residential:   { label: 'Residential',    color: '#4080e0', weight: 1.5, speed: 0.65, enabled: true  },
  unclassified:  { label: 'Unclassified',   color: '#8050d0', weight: 1.2, speed: 0.55, enabled: true  },
  service:       { label: 'Service',        color: '#507090', weight: 1.0, speed: 0.35, enabled: false },
  living_street: { label: 'Living Street',  color: '#306090', weight: 1.0, speed: 0.25, enabled: false },
};
