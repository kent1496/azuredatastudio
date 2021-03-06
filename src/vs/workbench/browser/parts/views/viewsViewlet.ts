/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the Source EULA. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from 'vs/base/browser/dom';
import { IAction } from 'vs/base/common/actions';
import { Separator } from 'vs/base/browser/ui/actionbar/actionbar';
import { IExtensionService } from 'vs/workbench/services/extensions/common/extensions';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { IViewDescriptor } from 'vs/workbench/common/views';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IStorageService } from 'vs/platform/storage/common/storage';
import { IWorkspaceContextService } from 'vs/platform/workspace/common/workspace';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { ViewPaneContainer, ViewPane, IViewPaneOptions } from 'vs/workbench/browser/parts/views/viewPaneContainer';
import { WorkbenchTree, IListService } from 'vs/platform/list/browser/listService';
import { IWorkbenchThemeService, IFileIconTheme } from 'vs/workbench/services/themes/common/workbenchThemeService';
import { ITreeConfiguration, ITreeOptions } from 'vs/base/parts/tree/browser/tree';
import { Event } from 'vs/base/common/event';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IWorkbenchLayoutService } from 'vs/workbench/services/layout/browser/layoutService';
import { IAddedViewDescriptorRef } from 'vs/workbench/browser/parts/views/views';

export interface IViewletViewOptions extends IViewPaneOptions {
}

export abstract class FilterViewPaneContainer extends ViewPaneContainer {
	private constantViewDescriptors: Map<string, IViewDescriptor> = new Map();
	private allViews: Map<string, Map<string, IViewDescriptor>> = new Map();
	private filterValue: string | undefined;

	constructor(
		viewletId: string,
		onDidChangeFilterValue: Event<string>,
		@IConfigurationService configurationService: IConfigurationService,
		@IWorkbenchLayoutService layoutService: IWorkbenchLayoutService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IStorageService storageService: IStorageService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IThemeService themeService: IThemeService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IExtensionService extensionService: IExtensionService,
		@IWorkspaceContextService contextService: IWorkspaceContextService
	) {

		super(viewletId, `${viewletId}.state`, { mergeViewWithContainerWhenSingleView: false }, instantiationService, configurationService, layoutService, contextMenuService, telemetryService, extensionService, themeService, storageService, contextService);
		this._register(onDidChangeFilterValue(newFilterValue => {
			this.filterValue = newFilterValue;
			this.onFilterChanged(newFilterValue);
		}));

		this._register(this.viewsModel.onDidChangeActiveViews((viewDescriptors) => {
			this.updateAllViews(viewDescriptors);
		}));
	}

	private updateAllViews(viewDescriptors: ReadonlyArray<IViewDescriptor>) {
		viewDescriptors.forEach(descriptor => {
			let filterOnValue = this.getFilterOn(descriptor);
			if (!filterOnValue) {
				return;
			}
			if (!this.allViews.has(filterOnValue)) {
				this.allViews.set(filterOnValue, new Map());
			}
			this.allViews.get(filterOnValue)!.set(descriptor.id, descriptor);
			if (filterOnValue !== this.filterValue) {
				this.viewsModel.setVisible(descriptor.id, false);
			}
		});
	}

	protected addConstantViewDescriptors(constantViewDescriptors: IViewDescriptor[]) {
		constantViewDescriptors.forEach(viewDescriptor => this.constantViewDescriptors.set(viewDescriptor.id, viewDescriptor));
	}

	protected abstract getFilterOn(viewDescriptor: IViewDescriptor): string | undefined;

	private onFilterChanged(newFilterValue: string) {
		if (this.allViews.size === 0) {
			this.updateAllViews(this.viewsModel.viewDescriptors);
		}
		this.getViewsNotForTarget(newFilterValue).forEach(item => this.viewsModel.setVisible(item.id, false));
		this.getViewsForTarget(newFilterValue).forEach(item => this.viewsModel.setVisible(item.id, true));
	}

	getContextMenuActions(): IAction[] {
		const result: IAction[] = [];
		let viewToggleActions: IAction[] = Array.from(this.constantViewDescriptors.values()).map(viewDescriptor => (<IAction>{
			id: `${viewDescriptor.id}.toggleVisibility`,
			label: viewDescriptor.name,
			checked: this.viewsModel.isVisible(viewDescriptor.id),
			enabled: viewDescriptor.canToggleVisibility,
			run: () => this.toggleViewVisibility(viewDescriptor.id)
		}));

		result.push(...viewToggleActions);
		const parentActions = super.getContextMenuActions();
		if (viewToggleActions.length && parentActions.length) {
			result.push(new Separator());
		}

		result.push(...parentActions);
		return result;
	}

	private getViewsForTarget(target: string): IViewDescriptor[] {
		return this.allViews.has(target) ? Array.from(this.allViews.get(target)!.values()) : [];
	}

	private getViewsNotForTarget(target: string): IViewDescriptor[] {
		const iterable = this.allViews.keys();
		let key = iterable.next();
		let views: IViewDescriptor[] = [];
		while (!key.done) {
			if (key.value !== target) {
				views = views.concat(this.getViewsForTarget(key.value));
			}
			key = iterable.next();
		}
		return views;
	}

	onDidAddViews(added: IAddedViewDescriptorRef[]): ViewPane[] {
		const panes: ViewPane[] = super.onDidAddViews(added);
		for (let i = 0; i < added.length; i++) {
			if (this.constantViewDescriptors.has(added[i].viewDescriptor.id)) {
				panes[i].setExpanded(false);
			}
		}
		// Check that allViews is ready
		if (this.allViews.size === 0) {
			this.updateAllViews(this.viewsModel.viewDescriptors);
		}
		return panes;
	}

	abstract getTitle(): string;
}

export class FileIconThemableWorkbenchTree extends WorkbenchTree {

	constructor(
		container: HTMLElement,
		configuration: ITreeConfiguration,
		options: ITreeOptions,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IListService listService: IListService,
		@IThemeService themeService: IWorkbenchThemeService,
		@IConfigurationService configurationService: IConfigurationService,
		@IInstantiationService instantiationService: IInstantiationService
	) {
		super(container, configuration, { ...options, ...{ showTwistie: false, twistiePixels: 12 } }, contextKeyService, listService, themeService, instantiationService, configurationService);

		DOM.addClass(container, 'file-icon-themable-tree');
		DOM.addClass(container, 'show-file-icons');

		const onFileIconThemeChange = (fileIconTheme: IFileIconTheme) => {
			DOM.toggleClass(container, 'align-icons-and-twisties', fileIconTheme.hasFileIcons && !fileIconTheme.hasFolderIcons);
			DOM.toggleClass(container, 'hide-arrows', fileIconTheme.hidesExplorerArrows === true);
		};

		this.disposables.push(themeService.onDidFileIconThemeChange(onFileIconThemeChange));
		onFileIconThemeChange(themeService.getFileIconTheme());
	}
}
