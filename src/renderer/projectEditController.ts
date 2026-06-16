import { defaultProjectNaming } from "../shared/projectOps";
import type { Project, ProjectNaming } from "../shared/types";

type ProjectUpdate = Project | ((currentProject: Project) => Project);

export const nextProjectNameEdit = (
  project: Project,
  name: string,
  updatedAt = new Date().toISOString()
): Project => ({
  ...project,
  name,
  updatedAt
});

export const nextProjectNamingEdit = (
  project: Project,
  field: keyof ProjectNaming,
  value: string,
  updatedAt = new Date().toISOString()
): Project => ({
  ...project,
  naming: {
    ...defaultProjectNaming,
    ...project.naming,
    [field]: value
  },
  updatedAt
});

export const nextShotScriptTextEdit = (
  project: Project,
  shotId: string,
  scriptText: string,
  updatedAt = new Date().toISOString()
): Project => ({
  ...project,
  shots: project.shots.map((shot) =>
    shot.id === shotId ? { ...shot, scriptText } : shot
  ),
  updatedAt
});

export const useProjectEditController = ({
  project,
  updateProject
}: {
  project: Project;
  updateProject: (projectUpdate: ProjectUpdate) => void;
}) => {
  const updateProjectName = (name: string) => {
    updateProject(nextProjectNameEdit(project, name));
  };

  const updateProjectNaming = (field: keyof ProjectNaming, value: string) => {
    updateProject(nextProjectNamingEdit(project, field, value));
  };

  const handleShotScriptText = (shotId: string, scriptText: string) => {
    updateProject((currentProject) =>
      nextShotScriptTextEdit(currentProject, shotId, scriptText)
    );
  };

  return {
    handleShotScriptText,
    updateProjectName,
    updateProjectNaming
  };
};
